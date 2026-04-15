"""Tracks CRUD + simple auto-match against stored GPS outlines."""

import json
import math

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from ..database import get_db

router = APIRouter()


class TrackIn(BaseModel):
    name: str
    country: str = ""
    length_m: float = 0
    gps_outline: List[List[float]] = []  # [[lat, lon], ...]
    sector_defs: List[dict] = []


class TrackOut(TrackIn):
    id: int


@router.get("/tracks")
async def list_tracks():
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, name, country, length_m, gps_outline_json, sector_defs_json FROM tracks ORDER BY name"
        )
        rows = await cur.fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "country": r["country"],
                "length_m": r["length_m"],
                "gps_outline": json.loads(r["gps_outline_json"] or "[]"),
                "sector_defs": json.loads(r["sector_defs_json"] or "[]"),
            }
            for r in rows
        ]
    finally:
        await db.close()


@router.post("/tracks")
async def create_track(t: TrackIn):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO tracks (name, country, length_m, gps_outline_json, sector_defs_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (t.name, t.country, t.length_m, json.dumps(t.gps_outline), json.dumps(t.sector_defs)),
        )
        await db.commit()
        return {"id": cur.lastrowid}
    finally:
        await db.close()


@router.delete("/tracks/{track_id}")
async def delete_track(track_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


def _centroid(points: List[List[float]]):
    if not points:
        return (0.0, 0.0)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    return (sx / len(points), sy / len(points))


class MatchRequest(BaseModel):
    gps_outline: List[List[float]]
    length_m: Optional[float] = None


@router.post("/tracks/match")
async def match_track(req: MatchRequest):
    """Find the closest stored track by centroid proximity + length similarity."""
    if not req.gps_outline:
        raise HTTPException(400, "gps_outline required")
    cand_centroid = _centroid(req.gps_outline)

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, name, length_m, gps_outline_json FROM tracks"
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    best = None
    best_score = float("inf")
    for r in rows:
        outline = json.loads(r["gps_outline_json"] or "[]")
        if not outline:
            continue
        c = _centroid(outline)
        # approx meters per degree near candidate latitude
        mlat = (cand_centroid[0] + c[0]) / 2
        mpd_lat = 111320.0
        mpd_lon = 111320.0 * max(0.01, math.cos(math.radians(mlat)))
        dx = (c[0] - cand_centroid[0]) * mpd_lat
        dy = (c[1] - cand_centroid[1]) * mpd_lon
        dist_m = math.hypot(dx, dy)
        len_penalty = 0.0
        if req.length_m and r["length_m"]:
            len_penalty = abs(req.length_m - r["length_m"])
        score = dist_m + len_penalty * 2
        if score < best_score:
            best_score = score
            best = {"id": r["id"], "name": r["name"], "distance_m": dist_m, "score": score}
    return {"match": best, "threshold_m": 500.0, "matched": bool(best and best["distance_m"] < 500)}
