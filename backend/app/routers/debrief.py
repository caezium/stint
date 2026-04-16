"""Auto-debrief endpoints."""

from fastapi import APIRouter, HTTPException

from ..database import get_db
from ..debrief import generate_debrief, get_cached_debrief

router = APIRouter()


async def _session_exists(session_id: str) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
        return (await cursor.fetchone()) is not None
    finally:
        await db.close()


@router.get("/sessions/{session_id}/debrief")
async def get_debrief(session_id: str):
    if not await _session_exists(session_id):
        raise HTTPException(404, "Session not found")
    cached = await get_cached_debrief(session_id)
    if cached:
        return cached
    # Cache miss: compute on demand
    try:
        return await generate_debrief(session_id)
    except Exception as e:
        raise HTTPException(500, f"Debrief generation failed: {e}")


@router.post("/sessions/{session_id}/debrief/recompute")
async def recompute_debrief(session_id: str):
    if not await _session_exists(session_id):
        raise HTTPException(404, "Session not found")
    try:
        return await generate_debrief(session_id)
    except Exception as e:
        raise HTTPException(500, f"Debrief generation failed: {e}")
