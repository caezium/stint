"""Tracks CRUD + simple auto-match against stored GPS outlines."""

import json
import math

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Any

from ..database import get_db
from .channels import _segments_cross, _find_arrow_file
import pyarrow.ipc as ipc

router = APIRouter()


class TrackIn(BaseModel):
    name: str
    country: str = ""
    length_m: float = 0
    gps_outline: List[List[float]] = []
    sector_defs: List[dict] = []
    short_name: str = ""
    city: str = ""
    type: str = ""
    surface: str = ""
    timezone: str = ""
    sf_line: Optional[dict] = None  # {lat1,lon1,lat2,lon2}
    split_lines: List[dict] = []
    pit_lane: List[List[float]] = []


def _row_to_track(r: Any) -> dict:
    keys = r.keys() if hasattr(r, "keys") else []
    def g(k, default=None):
        return r[k] if k in keys else default
    return {
        "id": r["id"],
        "name": r["name"],
        "country": r["country"],
        "length_m": r["length_m"],
        "gps_outline": json.loads(r["gps_outline_json"] or "[]"),
        "sector_defs": json.loads(r["sector_defs_json"] or "[]"),
        "short_name": g("short_name", "") or "",
        "city": g("city", "") or "",
        "type": g("type", "") or "",
        "surface": g("surface", "") or "",
        "timezone": g("timezone", "") or "",
        "sf_line": json.loads(g("sf_line_json", "") or "null") if (g("sf_line_json", "") or "") else None,
        "split_lines": json.loads(g("split_lines_json", "") or "[]"),
        "pit_lane": json.loads(g("pit_lane_json", "") or "[]"),
    }


@router.get("/tracks")
async def list_tracks():
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM tracks ORDER BY name")
        rows = await cur.fetchall()
        return [_row_to_track(r) for r in rows]
    finally:
        await db.close()


@router.get("/tracks/{track_id}")
async def get_track(track_id: int):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Track not found")
        return _row_to_track(row)
    finally:
        await db.close()


@router.post("/tracks")
async def create_track(t: TrackIn):
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO tracks
               (name, country, length_m, gps_outline_json, sector_defs_json,
                short_name, city, type, surface, timezone,
                sf_line_json, split_lines_json, pit_lane_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                t.name, t.country, t.length_m,
                json.dumps(t.gps_outline), json.dumps(t.sector_defs),
                t.short_name, t.city, t.type, t.surface, t.timezone,
                json.dumps(t.sf_line) if t.sf_line else "",
                json.dumps(t.split_lines),
                json.dumps(t.pit_lane),
            ),
        )
        await db.commit()
        return {"id": cur.lastrowid}
    finally:
        await db.close()


@router.put("/tracks/{track_id}")
async def update_track(track_id: int, t: TrackIn):
    db = await get_db()
    try:
        await db.execute(
            """UPDATE tracks SET name=?, country=?, length_m=?, gps_outline_json=?, sector_defs_json=?,
               short_name=?, city=?, type=?, surface=?, timezone=?,
               sf_line_json=?, split_lines_json=?, pit_lane_json=?
               WHERE id=?""",
            (
                t.name, t.country, t.length_m,
                json.dumps(t.gps_outline), json.dumps(t.sector_defs),
                t.short_name, t.city, t.type, t.surface, t.timezone,
                json.dumps(t.sf_line) if t.sf_line else "",
                json.dumps(t.split_lines),
                json.dumps(t.pit_lane),
                track_id,
            ),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


class SfLineBody(BaseModel):
    lat1: float
    lon1: float
    lat2: float
    lon2: float


@router.put("/tracks/{track_id}/sf-line")
async def set_track_sf_line(track_id: int, body: SfLineBody):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE tracks SET sf_line_json=? WHERE id=?",
            (json.dumps(body.dict()), track_id),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


class PitLaneVertex(BaseModel):
    lat: float
    lon: float


class PitLaneBody(BaseModel):
    polygon: List[PitLaneVertex]


@router.put("/tracks/{track_id}/pit-lane")
async def set_track_pit_lane(track_id: int, body: PitLaneBody):
    db = await get_db()
    try:
        poly = [[v.lat, v.lon] for v in body.polygon]
        await db.execute(
            "UPDATE tracks SET pit_lane_json=? WHERE id=?",
            (json.dumps(poly), track_id),
        )
        await db.commit()
        return {"ok": True, "vertices": len(poly)}
    finally:
        await db.close()


class SplitsBody(BaseModel):
    splits: List[SfLineBody]


@router.put("/tracks/{track_id}/splits")
async def set_track_splits(track_id: int, body: SplitsBody):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE tracks SET split_lines_json=? WHERE id=?",
            (json.dumps([s.dict() for s in body.splits]), track_id),
        )
        await db.commit()
        return {"ok": True}
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


def _compute_crossings(lat, lon, tc, line: dict) -> list[int]:
    """Return timecodes at which trajectory crosses the given line."""
    mlat = (line["lat1"] + line["lat2"]) / 2
    mpd_lat = 111320.0
    mpd_lon = 111320.0 * max(0.01, math.cos(math.radians(mlat)))

    def to_xy(la, lo):
        return ((la - mlat) * mpd_lat, (lo - line["lon1"]) * mpd_lon)

    line_a = to_xy(line["lat1"], line["lon1"])
    line_b = to_xy(line["lat2"], line["lon2"])
    n = min(len(lat), len(lon), len(tc))
    crossings: list[int] = []
    prev = to_xy(lat[0], lon[0])
    for i in range(1, n):
        cur = to_xy(lat[i], lon[i])
        if _segments_cross(prev, cur, line_a, line_b):
            crossings.append(tc[i])
        prev = cur
    return crossings


async def recompute_session_from_track(session_id: str, track_id: int) -> dict:
    """Reusable: read track's sf_line_json + splits, rebuild laps and split times."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT sf_line_json, split_lines_json FROM tracks WHERE id = ?",
            (track_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Track not found")
        sf = json.loads(row["sf_line_json"] or "null") if (row["sf_line_json"] or "") else None
        splits = json.loads(row["split_lines_json"] or "[]")
    finally:
        await db.close()

    if not sf:
        raise HTTPException(400, "Track has no S/F line configured")

    lat_path = _find_arrow_file(session_id, "GPS Latitude") or _find_arrow_file(session_id, "GPS_Latitude")
    lon_path = _find_arrow_file(session_id, "GPS Longitude") or _find_arrow_file(session_id, "GPS_Longitude")
    if not lat_path or not lon_path:
        raise HTTPException(404, "No GPS data for this session")

    lat_table = ipc.open_file(lat_path).read_all()
    lon_table = ipc.open_file(lon_path).read_all()
    lat = lat_table.column(1).to_pylist()
    lon = lon_table.column(1).to_pylist()
    tc = lat_table.column("timecodes").to_pylist()

    crossings = _compute_crossings(lat, lon, tc, sf)
    if len(crossings) < 2:
        raise HTTPException(400, f"Only {len(crossings)} S/F crossings found for track")

    laps: list[dict] = [{
        "num": 0,
        "start_time_ms": tc[0],
        "end_time_ms": crossings[0],
        "duration_ms": crossings[0] - tc[0],
    }]
    for i in range(len(crossings) - 1):
        laps.append({
            "num": i + 1,
            "start_time_ms": crossings[i],
            "end_time_ms": crossings[i + 1],
            "duration_ms": crossings[i + 1] - crossings[i],
        })

    # Compute split crossings per lap
    split_crossings_by_split = []
    for sline in splits:
        split_crossings_by_split.append(_compute_crossings(lat, lon, tc, sline))

    for lap in laps:
        if lap["num"] == 0:
            lap["split_times"] = []
            continue
        splits_for_lap = []
        for sc in split_crossings_by_split:
            # find first crossing between lap start and lap end
            hit = next((t for t in sc if lap["start_time_ms"] < t < lap["end_time_ms"]), None)
            splits_for_lap.append((hit - lap["start_time_ms"]) if hit is not None else None)
        lap["split_times"] = splits_for_lap

    db = await get_db()
    try:
        await db.execute("DELETE FROM laps WHERE session_id = ?", (session_id,))
        await db.executemany(
            "INSERT INTO laps (session_id, num, start_time_ms, end_time_ms, duration_ms, split_times_json) VALUES (?,?,?,?,?,?)",
            [(session_id, l["num"], l["start_time_ms"], l["end_time_ms"], l["duration_ms"],
              json.dumps(l.get("split_times", []))) for l in laps],
        )
        racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
        best = min((l["duration_ms"] for l in racing), default=0)
        await db.execute(
            "UPDATE sessions SET lap_count = ?, best_lap_time_ms = ?, track_id = ? WHERE id = ?",
            (len(laps), best, track_id, session_id),
        )
        await db.commit()
    finally:
        await db.close()

    return {"laps": laps, "crossings": len(crossings), "best_lap_time_ms": best,
            "splits_configured": len(splits)}


@router.post("/sessions/{session_id}/recompute-from-track")
async def recompute_session_from_track_endpoint(
    session_id: str, track_id: int = Query(...)
):
    return await recompute_session_from_track(session_id, track_id)
