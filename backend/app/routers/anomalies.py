"""Anomaly detection endpoints."""

from fastapi import APIRouter, HTTPException

from ..anomalies import (
    detect_session_anomalies,
    get_anomaly_counts,
    get_session_anomalies,
)
from ..database import get_db

router = APIRouter()


async def _session_exists(session_id: str) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT 1 FROM sessions WHERE id = ?", (session_id,)
        )
        return (await cursor.fetchone()) is not None
    finally:
        await db.close()


@router.get("/sessions/{session_id}/anomalies")
async def list_anomalies(session_id: str):
    if not await _session_exists(session_id):
        raise HTTPException(404, "Session not found")
    items = await get_session_anomalies(session_id)
    counts = await get_anomaly_counts(session_id)
    return {"counts": counts, "items": items}


@router.get("/sessions/{session_id}/anomalies/summary")
async def summary(session_id: str):
    if not await _session_exists(session_id):
        raise HTTPException(404, "Session not found")
    return await get_anomaly_counts(session_id)


@router.post("/sessions/{session_id}/anomalies/recompute")
async def recompute(session_id: str):
    if not await _session_exists(session_id):
        raise HTTPException(404, "Session not found")
    try:
        items = await detect_session_anomalies(session_id)
    except Exception as e:
        raise HTTPException(500, f"Anomaly detection failed: {e}")
    return {"count": len(items), "items": items}
