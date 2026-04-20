"""Persistent job queue — status endpoints + in-process worker."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from typing import Optional

from ..database import get_db
from ..jobs import enqueue_job, worker_tick

router = APIRouter()


@router.get("/jobs")
async def list_jobs(
    session_id: Optional[str] = None,
    kind: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
):
    db = await get_db()
    try:
        q = (
            "SELECT id, session_id, kind, status, started_at, finished_at, "
            "error_message, attempt, created_at FROM job_runs WHERE 1=1"
        )
        params: list = []
        if session_id is not None:
            q += " AND session_id = ?"
            params.append(session_id)
        if kind is not None:
            q += " AND kind = ?"
            params.append(kind)
        if status is not None:
            q += " AND status = ?"
            params.append(status)
        q += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))
        cur = await db.execute(q, params)
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post("/jobs/{kind}")
async def enqueue(kind: str, session_id: Optional[str] = None):
    jid = await enqueue_job(kind, session_id)
    return {"id": jid, "kind": kind, "session_id": session_id}


@router.post("/jobs/tick")
async def manual_tick():
    """Trigger a single worker pass immediately (debug/dev aid)."""
    processed = await worker_tick()
    return {"processed": processed}


__all__ = ["router"]
