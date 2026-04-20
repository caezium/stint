"""Lap annotations — driver-authored notes anchored to (session, lap, distance_pct)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class AnnotationRequest(BaseModel):
    lap_num: int
    distance_pct: Optional[float] = None
    time_in_lap_ms: Optional[int] = None
    author: str = ""
    body: str


@router.get("/sessions/{session_id}/annotations")
async def list_annotations(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT id, session_id, lap_num, distance_pct, time_in_lap_ms,
                      author, body, created_at
               FROM lap_annotations
               WHERE session_id = ?
               ORDER BY lap_num, COALESCE(distance_pct, 0), id""",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post("/sessions/{session_id}/annotations")
async def create_annotation(session_id: str, req: AnnotationRequest):
    body = (req.body or "").strip()
    if not body:
        raise HTTPException(400, "body is required")
    if len(body) > 1000:
        raise HTTPException(400, "body must be 1000 chars or fewer")

    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "session not found")
        cur = await db.execute(
            """INSERT INTO lap_annotations
               (session_id, lap_num, distance_pct, time_in_lap_ms, author, body)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                req.lap_num,
                req.distance_pct,
                req.time_in_lap_ms,
                (req.author or "").strip()[:80],
                body,
            ),
        )
        await db.commit()
        new_id = int(cur.lastrowid)
        cur = await db.execute(
            """SELECT id, session_id, lap_num, distance_pct, time_in_lap_ms,
                      author, body, created_at FROM lap_annotations WHERE id = ?""",
            (new_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else {"id": new_id}
    finally:
        await db.close()


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(annotation_id: int):
    db = await get_db()
    try:
        res = await db.execute(
            "DELETE FROM lap_annotations WHERE id = ?", (annotation_id,)
        )
        await db.commit()
        if res.rowcount == 0:
            raise HTTPException(404, "annotation not found")
        return {"deleted": annotation_id}
    finally:
        await db.close()
