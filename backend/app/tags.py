"""Session auto-tags (T2.6).

Pure-rules layer over consistency stats + anomalies. Computed at the end of
the upload pipeline so the session list page can render colored badges:

* clean — zero critical anomalies, COV < 1.5%
* mechanical-concerns — any cooling/voltage/rpm/brake-fade in critical/warning
* inconsistent — COV ≥ 3%
* personal-best — best-lap < min(prior sessions same venue+vehicle)
"""

from __future__ import annotations

import json
from typing import Optional

from .database import get_db


MECHANICAL_TYPES = {
    "cooling_peak",
    "cooling_trend",
    "voltage_sag",
    "voltage_swing",
    "rpm_dropout",
    "brake_fade",
    "sensor_flatline",
    "pedal_tps_mismatch",
}


async def _fetch_meta(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT venue, vehicle, best_lap_time_ms, log_date FROM sessions WHERE id = ?",
            (session_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def _fetch_anomalies(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT type, severity FROM anomalies WHERE session_id = ?",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def _fetch_debrief(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json FROM debriefs WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        if not row:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None
    finally:
        await db.close()


async def _is_personal_best(session_id: str, venue: str, vehicle: str, best_ms: int) -> bool:
    if not venue or not vehicle or not best_ms:
        return False
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT MIN(best_lap_time_ms) AS prev FROM sessions "
            "WHERE id != ? AND venue = ? AND vehicle = ? AND best_lap_time_ms > 0",
            (session_id, venue, vehicle),
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    prev = row["prev"] if row and row["prev"] else None
    return bool(prev) and best_ms < int(prev)


async def compute_session_tags(session_id: str) -> list[str]:
    meta = await _fetch_meta(session_id)
    if not meta:
        return []
    anomalies = await _fetch_anomalies(session_id)
    debrief = await _fetch_debrief(session_id)
    cons = (debrief or {}).get("lap_consistency") or {}
    cov = cons.get("coefficient_of_variation")

    tags: list[str] = []

    has_critical_mech = any(
        a["severity"] == "critical" and a["type"] in MECHANICAL_TYPES for a in anomalies
    )
    has_warning_mech = any(
        a["severity"] in ("critical", "warning") and a["type"] in MECHANICAL_TYPES
        for a in anomalies
    )
    if has_warning_mech:
        tags.append("mechanical-concerns")

    if cov is not None:
        if cov >= 0.03:
            tags.append("inconsistent")
        elif cov < 0.015 and not has_critical_mech:
            tags.append("clean")

    if await _is_personal_best(
        session_id,
        meta.get("venue") or "",
        meta.get("vehicle") or "",
        int(meta.get("best_lap_time_ms") or 0),
    ):
        tags.append("personal-best")

    await _persist(session_id, tags)
    return tags


async def _persist(session_id: str, tags: list[str]) -> None:
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM session_tags WHERE session_id = ?", (session_id,)
        )
        if tags:
            await db.executemany(
                "INSERT INTO session_tags (session_id, tag) VALUES (?, ?)",
                [(session_id, t) for t in tags],
            )
        await db.commit()
    finally:
        await db.close()


async def get_tags(session_id: str) -> list[str]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT tag FROM session_tags WHERE session_id = ?", (session_id,)
        )
        return [r["tag"] for r in await cur.fetchall()]
    finally:
        await db.close()


async def get_tags_for_sessions(session_ids: list[str]) -> dict[str, list[str]]:
    """Bulk fetch tags for use by the session-list endpoint."""
    if not session_ids:
        return {}
    db = await get_db()
    try:
        placeholders = ",".join(["?"] * len(session_ids))
        cur = await db.execute(
            f"SELECT session_id, tag FROM session_tags WHERE session_id IN ({placeholders})",
            session_ids,
        )
        out: dict[str, list[str]] = {}
        for r in await cur.fetchall():
            out.setdefault(r["session_id"], []).append(r["tag"])
        return out
    finally:
        await db.close()
