"""Channel alarms — user-configurable thresholds that feed the anomaly
watchdog alongside the hard-coded detectors. Phase 19."""

from __future__ import annotations

from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..channels import match_channel, read_channel
from ..database import get_db

router = APIRouter()


_VALID_KINDS = {"min", "max", "between", "outside"}
_VALID_SEVERITIES = {"info", "warning", "critical"}
_VALID_SCOPES = {"session", "driver", "global"}


class AlarmIn(BaseModel):
    scope: str = "global"
    session_id: Optional[str] = None
    driver: Optional[str] = None
    channel: str
    kind: str
    threshold_a: Optional[float] = None
    threshold_b: Optional[float] = None
    severity: str = "warning"
    message: Optional[str] = None


def _validate(req: AlarmIn) -> None:
    if req.scope not in _VALID_SCOPES:
        raise HTTPException(400, f"scope must be one of {_VALID_SCOPES}")
    if req.kind not in _VALID_KINDS:
        raise HTTPException(400, f"kind must be one of {_VALID_KINDS}")
    if req.severity not in _VALID_SEVERITIES:
        raise HTTPException(400, f"severity must be one of {_VALID_SEVERITIES}")
    if req.kind in ("min", "max") and req.threshold_a is None:
        raise HTTPException(400, f"kind={req.kind} requires threshold_a")
    if req.kind in ("between", "outside") and (
        req.threshold_a is None or req.threshold_b is None
    ):
        raise HTTPException(400, f"kind={req.kind} requires threshold_a and threshold_b")
    if req.scope == "session" and not req.session_id:
        raise HTTPException(400, "scope='session' requires session_id")
    if req.scope == "driver" and not req.driver:
        raise HTTPException(400, "scope='driver' requires driver")


@router.get("/alarms")
async def list_alarms(
    session_id: Optional[str] = None,
    driver: Optional[str] = None,
):
    """List alarms, optionally filtered to those applicable to a given
    session or driver. Returns alarms ordered global → driver → session so
    UIs can render the inheritance chain."""
    db = await get_db()
    try:
        q = (
            "SELECT id, scope, session_id, driver, channel, kind, "
            "threshold_a, threshold_b, severity, message, created_at "
            "FROM channel_alarms WHERE 1=1"
        )
        params: list = []
        if session_id is not None or driver is not None:
            # Scope-aware filter: include global + driver + session-matching.
            q += " AND (scope = 'global'"
            if driver:
                q += " OR (scope = 'driver' AND driver = ?)"
                params.append(driver)
            if session_id:
                q += " OR (scope = 'session' AND session_id = ?)"
                params.append(session_id)
            q += ")"
        q += (
            " ORDER BY CASE scope WHEN 'global' THEN 0 "
            "WHEN 'driver' THEN 1 ELSE 2 END, created_at DESC"
        )
        cur = await db.execute(q, params)
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.post("/alarms")
async def create_alarm(req: AlarmIn):
    _validate(req)
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO channel_alarms
               (scope, session_id, driver, channel, kind,
                threshold_a, threshold_b, severity, message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                req.scope,
                req.session_id if req.scope == "session" else None,
                (req.driver or "") if req.scope == "driver" else "",
                req.channel,
                req.kind,
                req.threshold_a,
                req.threshold_b,
                req.severity,
                (req.message or "")[:200],
            ),
        )
        await db.commit()
        return {"id": int(cur.lastrowid)}
    finally:
        await db.close()


@router.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: int):
    db = await get_db()
    try:
        res = await db.execute(
            "DELETE FROM channel_alarms WHERE id = ?", (alarm_id,)
        )
        await db.commit()
        if res.rowcount == 0:
            raise HTTPException(404, "alarm not found")
        return {"deleted": alarm_id}
    finally:
        await db.close()


class AlarmPreviewRequest(BaseModel):
    alarm: AlarmIn


@router.post("/sessions/{session_id}/alarms/preview")
async def preview_alarm(session_id: str, req: AlarmPreviewRequest):
    """Evaluate an alarm draft against a session WITHOUT saving it. Returns
    the lap numbers and sample counts that would trigger. Powers the
    "Preview triggers" button in the alarm editor."""
    _validate(req.alarm)
    a = req.alarm

    # Load channel samples
    # Resolve the channel via fuzzy matcher (supports "Speed" → "GPS Speed")
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT name FROM channels WHERE session_id = ?", (session_id,)
        )
        channel_list = [r[0] for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT num, start_time_ms, end_time_ms FROM laps "
            "WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        laps = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    resolved = match_channel(channel_list, [a.channel]) or a.channel
    vals = read_channel(session_id, resolved)
    if vals is None or len(vals) == 0:
        return {"channel": resolved, "triggering_laps": [], "sample_count": 0}

    arr = np.asarray(vals, dtype=np.float64)

    def _hits(x: np.ndarray) -> np.ndarray:
        if a.kind == "min":
            return x < float(a.threshold_a or 0.0)
        if a.kind == "max":
            return x > float(a.threshold_a or 0.0)
        lo, hi = float(a.threshold_a or 0.0), float(a.threshold_b or 0.0)
        if a.kind == "between":
            return (x >= lo) & (x <= hi)
        return (x < lo) | (x > hi)  # outside

    mask = _hits(arr)
    total = int(mask.sum())
    # Approximate lap distribution (lap bounds use timecodes-by-lap; for
    # preview we just index by the sample ratio since resample timing is
    # uniform enough per lap).
    lap_hits: dict[int, int] = {}
    if laps and total > 0 and len(arr) >= len(laps):
        # Assume samples are evenly distributed across the session.
        total_samples = len(arr)
        for lap in laps:
            if lap["num"] <= 0:
                continue
            s_frac = 0.0
            e_frac = 1.0
            duration = sum(l["end_time_ms"] - l["start_time_ms"] for l in laps)
            if duration > 0:
                cum_before = sum(
                    l["end_time_ms"] - l["start_time_ms"]
                    for l in laps
                    if l["num"] < lap["num"]
                )
                s_frac = cum_before / duration
                e_frac = (cum_before + (lap["end_time_ms"] - lap["start_time_ms"])) / duration
            s_idx = int(s_frac * total_samples)
            e_idx = int(e_frac * total_samples)
            segment = mask[s_idx:e_idx]
            count = int(segment.sum())
            if count > 0:
                lap_hits[lap["num"]] = count

    return {
        "channel": resolved,
        "triggering_laps": [
            {"lap_num": ln, "samples": n} for ln, n in sorted(lap_hits.items())
        ],
        "sample_count": total,
    }
