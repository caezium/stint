"""Helpers that decorate the chat experience: suggestion chips (T1.2),
proactive nudges (T3.3), driver fingerprint benchmarks (T3.4)."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..database import get_db


router = APIRouter()


# ---------------------------------------------------------------------------
# T1.2 — dynamic suggestion chips derived from debrief + anomalies
# ---------------------------------------------------------------------------


def _suggestions_from(debrief: Optional[dict], anomalies: list[dict]) -> list[str]:
    chips: list[str] = []

    sectors = (debrief or {}).get("sector_consistency") or []
    if sectors:
        # Find the worst sector by stddev
        worst = max(sectors, key=lambda s: s.get("stddev_ms") or 0)
        if (worst.get("stddev_ms") or 0) > 50:
            chips.append(
                f"Why am I inconsistent in S{worst.get('sector_num')}?"
            )

    cons = (debrief or {}).get("lap_consistency") or {}
    if cons.get("best_streak") and cons.get("lap_count"):
        chips.append("Where am I losing the most time vs my best lap?")

    fp = (debrief or {}).get("driving_fingerprint") or {}
    if fp.get("throttle_smoothness") is not None and fp["throttle_smoothness"] < 0.3:
        chips.append("How can I smooth out my throttle application?")

    # Anomaly-driven prompts
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    sorted_anoms = sorted(
        anomalies, key=lambda a: severity_order.get(a.get("severity", "info"), 3)
    )
    for a in sorted_anoms[:3]:
        if a["type"].startswith("cooling"):
            chips.append("Explain the cooling trend.")
        elif a["type"] == "voltage_sag":
            chips.append("Tell me about the voltage drop.")
        elif a["type"] == "rpm_dropout":
            chips.append("What caused the RPM dropouts?")
        elif a["type"] == "brake_fade":
            chips.append("Is my brake fade serious?")
        elif a["type"] in ("understeer", "oversteer"):
            chips.append(
                f"Where can I see the {a['type']} in the data?"
            )
        elif a["type"] == "lap_inconsistency":
            chips.append("Which laps are pulling my consistency down?")
        elif a["type"] == "pace_decay":
            chips.append("Is my pace decay tire deg or fuel load?")

    # De-dupe while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for c in chips:
        if c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out[:5]


@router.get("/sessions/{session_id}/chat-suggestions")
async def chat_suggestions(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT 1 FROM sessions WHERE id = ?", (session_id,)
        )
        if not await cur.fetchone():
            raise HTTPException(404, "Session not found")
        cur = await db.execute(
            "SELECT payload_json FROM debriefs WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        debrief = None
        if row:
            try:
                debrief = json.loads(row["payload_json"])
            except Exception:
                debrief = None
        cur = await db.execute(
            "SELECT type, severity FROM anomalies WHERE session_id = ?",
            (session_id,),
        )
        anomalies = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    return {"suggestions": _suggestions_from(debrief, anomalies)}


# ---------------------------------------------------------------------------
# T3.3 — proactive nudge (most-severe finding, dismissible)
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/nudge")
async def get_nudge(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json, dismissed_at FROM proactive_nudges "
            "WHERE session_id = ?",
            (session_id,),
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row or row["dismissed_at"]:
        return {"nudge": None}
    try:
        return {"nudge": json.loads(row["payload_json"])}
    except Exception:
        return {"nudge": None}


@router.post("/sessions/{session_id}/nudge/dismiss")
async def dismiss_nudge(session_id: str):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE proactive_nudges SET dismissed_at = datetime('now') "
            "WHERE session_id = ?",
            (session_id,),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


async def maybe_create_nudge(session_id: str) -> None:
    """Called by the upload pipeline after anomaly detection finishes."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT type, severity, message, lap_num FROM anomalies "
            "WHERE session_id = ? AND severity IN ('critical', 'warning') "
            "ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END LIMIT 1",
            (session_id,),
        )
        row = await cur.fetchone()
        if not row:
            await db.execute(
                "DELETE FROM proactive_nudges WHERE session_id = ?", (session_id,)
            )
            await db.commit()
            return
        anomaly = dict(row)
        prompt = (
            f"Tell me about the {anomaly['type'].replace('_', ' ')} on lap "
            f"{anomaly['lap_num']}." if anomaly["lap_num"]
            else f"Tell me about the {anomaly['type'].replace('_', ' ')}."
        )
        nudge = {
            "headline": "Stint noticed something",
            "detail": anomaly["message"],
            "severity": anomaly["severity"],
            "prompt": prompt,
        }
        await db.execute(
            """INSERT INTO proactive_nudges (session_id, payload_json, created_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(session_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 created_at = excluded.created_at,
                 dismissed_at = NULL""",
            (session_id, json.dumps(nudge)),
        )
        await db.commit()
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# T3.4 — driver-historical fingerprint percentile bands
# ---------------------------------------------------------------------------


def _percentile(arr: list[float], p: float) -> Optional[float]:
    if not arr:
        return None
    arr = sorted(arr)
    if len(arr) == 1:
        return arr[0]
    k = (len(arr) - 1) * p
    f = int(k)
    c = min(f + 1, len(arr) - 1)
    if f == c:
        return arr[f]
    return arr[f] + (arr[c] - arr[f]) * (k - f)


# ---------------------------------------------------------------------------
# Per-lap fingerprints (T2.4) and tags (T2.6) — small read endpoints
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/fingerprints")
async def session_fingerprints(session_id: str):
    from ..debrief import get_per_lap_fingerprints
    rows = await get_per_lap_fingerprints(session_id)
    return {"laps": rows}


@router.get("/sessions/{session_id}/tags")
async def session_tags(session_id: str):
    from ..tags import get_tags
    return {"tags": await get_tags(session_id)}


# ---------------------------------------------------------------------------
# T4.1 — coaching plan + prior-session results
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/coaching-plan")
async def coaching_plan(session_id: str):
    from ..plans import get_plan, get_prior_plan_results
    return {
        "plan": await get_plan(session_id),
        "prior": await get_prior_plan_results(session_id),
    }


@router.post("/sessions/{session_id}/coaching-plan/regenerate")
async def regenerate_coaching_plan(session_id: str):
    from ..plans import generate_plan, evaluate_prior_plan, get_plan, get_prior_plan_results
    await evaluate_prior_plan(session_id)
    await generate_plan(session_id)
    return {
        "plan": await get_plan(session_id),
        "prior": await get_prior_plan_results(session_id),
    }


# ---------------------------------------------------------------------------
# T3.7 — chat usage / cost summary
# ---------------------------------------------------------------------------


@router.get("/chat/usage")
async def chat_usage():
    """Aggregate token usage so the settings page can display monthly totals."""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT
                 COALESCE(SUM(tokens_in), 0)  AS total_in,
                 COALESCE(SUM(tokens_out), 0) AS total_out,
                 COALESCE(SUM(CASE WHEN created_at >= date('now', 'start of month')
                                   THEN tokens_in END), 0)  AS month_in,
                 COALESCE(SUM(CASE WHEN created_at >= date('now', 'start of month')
                                   THEN tokens_out END), 0) AS month_out,
                 COUNT(*) AS message_count
               FROM chat_messages WHERE role = 'assistant'"""
        )
        row = await cur.fetchone()
        cur = await db.execute(
            "SELECT model, COUNT(*) AS n FROM chat_messages "
            "WHERE role = 'assistant' AND model IS NOT NULL AND model != '' "
            "GROUP BY model ORDER BY n DESC"
        )
        per_model = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {
        "total_tokens_in": int(row["total_in"]),
        "total_tokens_out": int(row["total_out"]),
        "month_tokens_in": int(row["month_in"]),
        "month_tokens_out": int(row["month_out"]),
        "message_count": int(row["message_count"]),
        "per_model": per_model,
    }


@router.get("/drivers/{driver}/fingerprint-stats")
async def driver_fingerprint_stats(driver: str):
    """Return p25/p50/p75 bands for each fingerprint metric across all of a
    driver's historical sessions. Used to render mini-bar benchmarks (T3.4).
    """
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT lf.throttle_smoothness, lf.braking_aggressiveness,
                      lf.max_brake, lf.steering_smoothness
               FROM lap_fingerprints lf
               JOIN sessions s ON s.id = lf.session_id
               WHERE s.driver = ?""",
            (driver,),
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    metrics = {
        "throttle_smoothness": [],
        "braking_aggressiveness": [],
        "max_brake": [],
        "steering_smoothness": [],
    }
    for r in rows:
        for k in metrics:
            v = r[k]
            if v is not None:
                metrics[k].append(float(v))

    out: dict[str, dict] = {}
    for k, vals in metrics.items():
        out[k] = {
            "p25": _percentile(vals, 0.25),
            "p50": _percentile(vals, 0.50),
            "p75": _percentile(vals, 0.75),
            "n": len(vals),
        }
    return {"driver": driver, "metrics": out}
