"""Coach share links — read-only /share/sessions/[token] URLs."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException

from ..database import get_db

router = APIRouter()


def _new_token() -> str:
    return secrets.token_urlsafe(24)


@router.post("/sessions/{session_id}/share")
async def create_share(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "session not found")
        token = _new_token()
        await db.execute(
            "INSERT INTO share_tokens (token, session_id, scope) VALUES (?, ?, 'session')",
            (token, session_id),
        )
        await db.commit()
        return {"token": token, "url": f"/share/sessions/{token}"}
    finally:
        await db.close()


@router.get("/sessions/{session_id}/shares")
async def list_shares(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT token, scope, created_at, expires_at, revoked_at, view_count "
            "FROM share_tokens WHERE session_id = ? ORDER BY created_at DESC",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.delete("/shares/{token}")
async def revoke_share(token: str):
    db = await get_db()
    try:
        res = await db.execute(
            "UPDATE share_tokens SET revoked_at = datetime('now') WHERE token = ?",
            (token,),
        )
        await db.commit()
        if res.rowcount == 0:
            raise HTTPException(404, "share not found")
        return {"revoked": token}
    finally:
        await db.close()


@router.get("/share/{token}")
async def resolve_share(token: str):
    """Public projection of a shared session. No auth required."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT session_id, revoked_at, expires_at FROM share_tokens WHERE token = ?",
            (token,),
        )
        tok = await cur.fetchone()
        if not tok:
            raise HTTPException(404, "share not found")
        if tok["revoked_at"]:
            raise HTTPException(410, "share revoked")
        if tok["expires_at"]:
            cur = await db.execute("SELECT datetime('now') > ? AS expired", (tok["expires_at"],))
            r = await cur.fetchone()
            if r and r["expired"]:
                raise HTTPException(410, "share expired")

        session_id = tok["session_id"]
        cur = await db.execute(
            "SELECT id, driver, vehicle, venue, log_date, lap_count, "
            "best_lap_time_ms, total_duration_ms, logger_model "
            "FROM sessions WHERE id = ?",
            (session_id,),
        )
        session = await cur.fetchone()
        if not session:
            raise HTTPException(404, "session not found")

        cur = await db.execute(
            "SELECT num, duration_ms, is_pit_lap FROM laps WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        laps = [dict(r) for r in await cur.fetchall()]

        await db.execute(
            "UPDATE share_tokens SET view_count = view_count + 1 WHERE token = ?",
            (token,),
        )
        await db.commit()

        return {
            "session": dict(session),
            "laps": laps,
            "read_only": True,
        }
    finally:
        await db.close()
