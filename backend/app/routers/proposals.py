"""Proposals — chat-agent-suggested layouts / math channels pending user Apply."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class ProposalIn(BaseModel):
    session_id: str
    kind: str
    payload_json: dict
    source: str = "chat"


@router.get("/sessions/{session_id}/proposals")
async def list_proposals(session_id: str, status: str = "pending"):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT id, session_id, kind, payload_json, status, source,
                      created_at, applied_at, rejected_at
               FROM proposals
               WHERE session_id = ? AND status = ?
               ORDER BY id DESC""",
            (session_id, status),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    for r in rows:
        try:
            r["payload"] = json.loads(r.pop("payload_json") or "null")
        except Exception:
            r["payload"] = None
    return rows


@router.post("/proposals")
async def create_proposal(req: ProposalIn):
    """Create a proposal directly (chat tool dispatch usually uses the helper)."""
    if req.kind not in ("layout", "math_channel"):
        raise HTTPException(400, f"unknown kind: {req.kind}")
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO proposals (session_id, kind, payload_json, source)
               VALUES (?, ?, ?, ?)""",
            (req.session_id, req.kind, json.dumps(req.payload_json), req.source),
        )
        await db.commit()
        return {"id": int(cur.lastrowid)}
    finally:
        await db.close()


@router.post("/proposals/{proposal_id}/apply")
async def apply_proposal(proposal_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, session_id, kind, payload_json, status "
            "FROM proposals WHERE id = ?",
            (proposal_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "proposal not found")
        if row["status"] != "pending":
            raise HTTPException(400, f"proposal already {row['status']}")
        payload = json.loads(row["payload_json"] or "{}")

        if row["kind"] == "layout":
            # Persist a real layout, stripping the "proposed" marker if any.
            name = payload.get("name") or "Untitled"
            charts = json.dumps(payload.get("charts") or [])
            await db.execute(
                "INSERT INTO layouts (session_id, name, charts_json) VALUES (?, ?, ?)",
                (row["session_id"], name[:60], charts),
            )
        elif row["kind"] == "math_channel":
            # Persist one or many math channel proposals.
            chans = payload.get("channels") or [payload]
            for ch in chans:
                name = (ch.get("name") or "").strip()[:60]
                formula = (ch.get("formula") or "").strip()
                if not name or not formula:
                    continue
                await db.execute(
                    """INSERT INTO math_channels (session_id, name, formula, units)
                       VALUES (?, ?, ?, ?)""",
                    (row["session_id"], name, formula, (ch.get("units") or "")[:16]),
                )
        await db.execute(
            "UPDATE proposals SET status='applied', applied_at=datetime('now') WHERE id=?",
            (proposal_id,),
        )
        await db.commit()
        return {"id": proposal_id, "status": "applied"}
    finally:
        await db.close()


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT status FROM proposals WHERE id = ?", (proposal_id,)
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "proposal not found")
        if row["status"] != "pending":
            raise HTTPException(400, f"proposal already {row['status']}")
        await db.execute(
            "UPDATE proposals SET status='rejected', rejected_at=datetime('now') "
            "WHERE id=?",
            (proposal_id,),
        )
        await db.commit()
        return {"id": proposal_id, "status": "rejected"}
    finally:
        await db.close()
