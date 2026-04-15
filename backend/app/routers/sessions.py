"""Session listing and detail endpoints."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from ..database import get_db

router = APIRouter()


@router.get("/sessions")
async def list_sessions(
    driver: Optional[str] = None,
    venue: Optional[str] = None,
    driver_id: Optional[int] = None,
    vehicle_id: Optional[int] = None,
    search: Optional[str] = None,
    sort: str = Query(default="date_desc"),
):
    db = await get_db()
    try:
        query = "SELECT * FROM sessions WHERE 1=1"
        params = []

        if driver:
            query += " AND driver = ?"
            params.append(driver)
        if venue:
            query += " AND venue = ?"
            params.append(venue)
        if driver_id is not None:
            query += " AND driver_id = ?"
            params.append(driver_id)
        if vehicle_id is not None:
            query += " AND vehicle_id = ?"
            params.append(vehicle_id)
        if search:
            query += " AND (driver LIKE ? OR venue LIKE ? OR vehicle LIKE ? OR file_name LIKE ?)"
            params.extend([f"%{search}%"] * 4)

        if sort == "date_desc":
            query += " ORDER BY created_at DESC"
        elif sort == "date_asc":
            query += " ORDER BY created_at ASC"
        elif sort == "venue":
            query += " ORDER BY venue, created_at DESC"

        rows = await db.execute(query, params)
        sessions = [dict(row) async for row in rows]
        return sessions
    finally:
        await db.close()


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    db = await get_db()
    try:
        # Session metadata
        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        session = await cursor.fetchone()
        if not session:
            raise HTTPException(404, "Session not found")

        # Laps
        cursor = await db.execute(
            "SELECT * FROM laps WHERE session_id = ? ORDER BY num", (session_id,))
        laps = [dict(row) async for row in cursor]

        # Channels
        cursor = await db.execute(
            "SELECT * FROM channels WHERE session_id = ? ORDER BY category, name", (session_id,))
        channels = [dict(row) async for row in cursor]

        result = dict(session)
        result["laps"] = laps
        result["channels"] = channels
        return result
    finally:
        await db.close()


@router.get("/sessions/filters/options")
async def get_filter_options():
    """Get distinct drivers and venues for filter dropdowns."""
    db = await get_db()
    try:
        drivers_cursor = await db.execute("SELECT DISTINCT driver FROM sessions WHERE driver != '' ORDER BY driver")
        drivers = [row[0] async for row in drivers_cursor]

        venues_cursor = await db.execute("SELECT DISTINCT venue FROM sessions WHERE venue != '' ORDER BY venue")
        venues = [row[0] async for row in venues_cursor]

        return {"drivers": drivers, "venues": venues}
    finally:
        await db.close()


class AssignRequest(BaseModel):
    driver_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    track_id: Optional[int] = None


@router.put("/sessions/{session_id}/assign")
async def assign_session(session_id: str, req: AssignRequest):
    """Attach driver / vehicle / track FKs to a session. Pass null to clear."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Session not found")
        await db.execute(
            "UPDATE sessions SET driver_id = ?, vehicle_id = ?, track_id = ? WHERE id = ?",
            (req.driver_id, req.vehicle_id, req.track_id, session_id),
        )
        await db.commit()
        return {"session_id": session_id, "driver_id": req.driver_id,
                "vehicle_id": req.vehicle_id, "track_id": req.track_id}
    finally:
        await db.close()


class NoteRequest(BaseModel):
    note_text: str


@router.get("/sessions/{session_id}/notes")
async def get_notes(session_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT note_text, created_at, updated_at FROM session_notes WHERE session_id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return {"note_text": "", "created_at": None, "updated_at": None}
    finally:
        await db.close()


@router.put("/sessions/{session_id}/notes")
async def upsert_notes(session_id: str, req: NoteRequest):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO session_notes (session_id, note_text)
               VALUES (?, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 note_text = excluded.note_text,
                 updated_at = datetime('now')""",
            (session_id, req.note_text),
        )
        await db.commit()
        return {"session_id": session_id, "note_text": req.note_text}
    finally:
        await db.close()


@router.get("/sessions/collections")
async def get_collections():
    """Group sessions by venue and date as a tree structure."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, file_name, driver, vehicle, venue, log_date, lap_count, best_lap_time_ms FROM sessions ORDER BY venue, log_date DESC"
        )
        rows = [dict(row) async for row in cursor]

        tree: dict = {}
        for row in rows:
            venue = row.get("venue") or "Unknown Venue"
            date = row.get("log_date") or "Unknown Date"
            if venue not in tree:
                tree[venue] = {}
            if date not in tree[venue]:
                tree[venue][date] = []
            tree[venue][date].append(row)

        return tree
    finally:
        await db.close()


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Session not found")

        await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()

        # Clean up cache files
        import shutil, os
        from ..xrk_service import CACHE_DIR
        cache_dir = os.path.join(CACHE_DIR, session_id)
        if os.path.exists(cache_dir):
            shutil.rmtree(cache_dir)

        return {"deleted": session_id}
    finally:
        await db.close()
