"""Reference laps — first-class "this is my PB / benchmark" lap (Phase 15).

Compared against by the compare page, the track-map delta overlay, and the
session-hero "vs PB" pill. Auto-seeded from `sessions.best_lap_time_ms` on
startup; users can override with `kind='user'` references.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class CreateRefRequest(BaseModel):
    session_id: str
    lap_num: int
    name: Optional[str] = None
    set_default: bool = True


@router.get("/reference-laps")
async def list_reference_laps(
    driver: Optional[str] = None,
    venue: Optional[str] = None,
):
    """List reference laps optionally filtered by driver / venue."""
    db = await get_db()
    try:
        q = (
            "SELECT id, session_id, lap_num, driver, venue, name, kind, "
            "is_default, created_at FROM reference_laps WHERE 1=1"
        )
        params: list = []
        if driver:
            q += " AND driver = ?"
            params.append(driver)
        if venue:
            q += " AND venue = ?"
            params.append(venue)
        q += " ORDER BY is_default DESC, created_at DESC"
        cur = await db.execute(q, params)
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post("/reference-laps")
async def create_reference_lap(req: CreateRefRequest):
    """Create a user-defined reference lap.

    Looks up the session's driver + venue so the (driver, venue) key works
    for picker dropdowns downstream. If `set_default=True`, demotes any
    existing default for the same pair.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT driver, venue FROM sessions WHERE id = ?", (req.session_id,)
        )
        session = await cur.fetchone()
        if not session:
            raise HTTPException(404, "session not found")
        driver = (session["driver"] or "").strip()
        venue = (session["venue"] or "").strip()

        cur = await db.execute(
            "SELECT 1 FROM laps WHERE session_id = ? AND num = ? AND duration_ms > 0",
            (req.session_id, req.lap_num),
        )
        if not await cur.fetchone():
            raise HTTPException(400, f"lap {req.lap_num} not found for session")

        name = (req.name or f"User · L{req.lap_num}").strip()[:80]

        if req.set_default and driver and venue:
            await db.execute(
                "UPDATE reference_laps SET is_default = 0 "
                "WHERE driver = ? AND venue = ?",
                (driver, venue),
            )

        cur = await db.execute(
            """INSERT INTO reference_laps
               (session_id, lap_num, driver, venue, name, kind, is_default)
               VALUES (?, ?, ?, ?, ?, 'user', ?)""",
            (
                req.session_id,
                req.lap_num,
                driver,
                venue,
                name,
                1 if req.set_default else 0,
            ),
        )
        new_id = int(cur.lastrowid)
        await db.commit()
        return {"id": new_id}
    finally:
        await db.close()


@router.post("/reference-laps/{ref_id}/set-default")
async def set_default(ref_id: int):
    """Mark a reference as the default for its (driver, venue) pair."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT driver, venue FROM reference_laps WHERE id = ?", (ref_id,)
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "reference not found")
        driver = row["driver"] or ""
        venue = row["venue"] or ""
        await db.execute(
            "UPDATE reference_laps SET is_default = 0 "
            "WHERE driver = ? AND venue = ?",
            (driver, venue),
        )
        await db.execute(
            "UPDATE reference_laps SET is_default = 1 WHERE id = ?", (ref_id,)
        )
        await db.commit()
        return {"id": ref_id, "is_default": 1}
    finally:
        await db.close()


@router.delete("/reference-laps/{ref_id}")
async def delete_reference_lap(ref_id: int):
    db = await get_db()
    try:
        res = await db.execute(
            "DELETE FROM reference_laps WHERE id = ?", (ref_id,)
        )
        await db.commit()
        if res.rowcount == 0:
            raise HTTPException(404, "reference not found")
        return {"deleted": ref_id}
    finally:
        await db.close()


@router.get("/sessions/{session_id}/default-reference")
async def default_reference(session_id: str):
    """Resolve the reference lap applicable to this session's (driver, venue).

    Used by the session hero to compute "vs PB: +0.42s" and by the track
    map delta overlay to paint the driven line.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT driver, venue FROM sessions WHERE id = ?", (session_id,)
        )
        s = await cur.fetchone()
        if not s:
            raise HTTPException(404, "session not found")
        driver = (s["driver"] or "").strip()
        venue = (s["venue"] or "").strip()
        if not driver or not venue:
            return {"reference": None}
        cur = await db.execute(
            """SELECT id, session_id, lap_num, driver, venue, name, kind,
                      is_default, created_at FROM reference_laps
               WHERE driver = ? AND venue = ?
               ORDER BY is_default DESC,
                        CASE kind WHEN 'user' THEN 0 WHEN 'pb' THEN 1 ELSE 2 END,
                        created_at DESC
               LIMIT 1""",
            (driver, venue),
        )
        row = await cur.fetchone()
        if not row:
            return {"reference": None}
        ref = dict(row)
        # Enrich with lap duration + session label for the UI.
        if ref["session_id"]:
            cur = await db.execute(
                "SELECT duration_ms FROM laps WHERE session_id = ? AND num = ?",
                (ref["session_id"], ref["lap_num"]),
            )
            lap = await cur.fetchone()
            ref["duration_ms"] = int(lap[0]) if lap else None
        else:
            ref["duration_ms"] = None
        return {"reference": ref}
    finally:
        await db.close()
