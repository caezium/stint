"""
Structured coaching plan with memory (T4.1).

Two responsibilities:

1. ``generate_plan(session_id)`` — after a session upload + debrief, ask Claude
   for 3 actionable focus items with measurable targets. Persist into the
   ``coaching_plans`` / ``coaching_focus_items`` tables.
2. ``evaluate_prior_plan(session_id)`` — find the most recent prior session for
   the same (driver, venue, vehicle), read its focus items, and grade each one
   against the new session's stats. Statuses: ``improved | same | worse``.

The next session's UI then surfaces both:
  * "Last session you wanted to: X. Result: improved by 0.12 s."
  * "Focus for the next session: ..."
"""

from __future__ import annotations

import json
from typing import Any, Optional

from .database import get_db
from .llm_client import FAST_MODEL, make_client


# ---------------------------------------------------------------------------
# Metric extraction — pulls a small, well-known set of metric values from the
# debrief / per-lap fingerprint / coaching-points payloads so we can grade
# items uniformly. Whatever the LLM picks must reduce to one of these keys.
# ---------------------------------------------------------------------------


SUPPORTED_METRICS: list[str] = [
    "best_lap_ms",
    "lap_cov_pct",
    "throttle_smoothness",
    "steering_smoothness",
    "braking_aggressiveness",
    "best_sector_1_ms",
    "best_sector_2_ms",
    "best_sector_3_ms",
    "best_sector_4_ms",
    "best_sector_5_ms",
]

# Direction of "better" — True means lower is better (e.g. lap times),
# False means higher is better (e.g. smoothness).
LOWER_IS_BETTER: dict[str, bool] = {
    "best_lap_ms": True,
    "lap_cov_pct": True,
    "best_sector_1_ms": True,
    "best_sector_2_ms": True,
    "best_sector_3_ms": True,
    "best_sector_4_ms": True,
    "best_sector_5_ms": True,
    "throttle_smoothness": False,
    "steering_smoothness": False,
    "braking_aggressiveness": False,  # neutral, but treat as info
}


def _fmt(metric: str, value: float | None) -> str:
    if value is None:
        return "—"
    if metric.endswith("_ms"):
        return f"{value/1000:.3f}s"
    if metric.endswith("_pct"):
        return f"{value:.1f}%"
    return f"{value:.3f}"


async def _extract_metrics(session_id: str) -> dict[str, float | None]:
    """Read from debriefs + sector_times; return whatever metrics we can fill."""
    out: dict[str, float | None] = {k: None for k in SUPPORTED_METRICS}
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json FROM debriefs WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        if row:
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                payload = {}
            cons = payload.get("lap_consistency") or {}
            if cons.get("best_ms"):
                out["best_lap_ms"] = float(cons["best_ms"])
            cov = cons.get("coefficient_of_variation")
            if cov is not None:
                out["lap_cov_pct"] = float(cov) * 100.0
            fp = payload.get("driving_fingerprint") or {}
            for k in ("throttle_smoothness", "steering_smoothness", "braking_aggressiveness"):
                v = fp.get(k)
                if v is not None:
                    out[k] = float(v)

        cur = await db.execute(
            "SELECT sector_num, MIN(duration_ms) AS best FROM sector_times "
            "WHERE session_id = ? GROUP BY sector_num",
            (session_id,),
        )
        for r in await cur.fetchall():
            sn = int(r["sector_num"])
            if 1 <= sn <= 5:
                out[f"best_sector_{sn}_ms"] = float(r["best"])
    finally:
        await db.close()
    return out


# ---------------------------------------------------------------------------
# Plan generation
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = (
    "You are Stint, a racing telemetry coach. Given the structured debrief for "
    "a session, pick 3 things the driver should focus on next time. Reply with "
    "ONLY a JSON object of shape "
    '{"items": [{"item_text": str, "target_metric": str, "target_value": number}, ...]}. '
    "item_text: imperative coaching cue, max 12 words. target_metric must be one of: "
    + ", ".join(SUPPORTED_METRICS) + ". target_value is the goal (e.g., a target best "
    "lap in ms; a target throttle_smoothness; etc.). Keep targets realistic — 2-3% "
    "improvement, not pie-in-the-sky."
)


def _build_user_prompt(metrics: dict[str, float | None], debrief: dict, coaching_points: list[dict]) -> str:
    sectors = (debrief.get("sector_consistency") or [])[:6]
    sector_lines = [
        f"  S{s.get('sector_num')}: best {_fmt('best_sector_1_ms', s.get('best_ms'))}, "
        f"σ {s.get('stddev_ms', 0)} ms"
        for s in sectors
    ]
    cp_lines: list[str] = []
    for p in coaching_points[:6]:
        bits = []
        if p.get("brake_on_distance_into_sector_m") is not None:
            bits.append(f"brake-on @ {p['brake_on_distance_into_sector_m']}m")
        if p.get("apex_speed") is not None:
            bits.append(f"apex {p['apex_speed']} kph")
        if p.get("throttle_pickup_distance_into_sector_m") is not None:
            bits.append(f"throttle on @ {p['throttle_pickup_distance_into_sector_m']}m")
        if bits:
            cp_lines.append(f"  L{p.get('lap_num')} S{p.get('sector_num')}: " + " · ".join(bits))

    metric_lines = [
        f"  {k}: {_fmt(k, v)}"
        for k, v in metrics.items() if v is not None
    ]
    return (
        "Current session metrics:\n" + "\n".join(metric_lines) +
        "\n\nSectors:\n" + ("\n".join(sector_lines) or "  (no sector data)") +
        "\n\nSelected coaching points:\n" + ("\n".join(cp_lines) or "  (none)")
    )


async def _fetch_debrief(session_id: str) -> dict:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json FROM debriefs WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row:
        return {}
    try:
        return json.loads(row["payload_json"])
    except Exception:
        return {}


async def _fetch_coaching_points(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json FROM coaching_points WHERE session_id = ?",
            (session_id,),
        )
        rows = await cur.fetchall()
    finally:
        await db.close()
    out: list[dict] = []
    for r in rows:
        try:
            out.append(json.loads(r["payload_json"]))
        except Exception:
            continue
    return out


async def generate_plan(session_id: str) -> Optional[dict]:
    """Best-effort: produce 3 coaching items. Silently no-ops if no API key."""
    debrief = await _fetch_debrief(session_id)
    if not debrief:
        return None

    metrics = await _extract_metrics(session_id)
    coaching_points = await _fetch_coaching_points(session_id)

    client = await make_client()
    if client is None:
        return None
    items: list[dict] = []
    try:
        data = None
        last_err: Optional[Exception] = None
        # Up to 2 attempts: first regular, then one retry with an explicit
        # "ONLY JSON, no markdown" nudge. Silent plan failures are one of the
        # top reported bugs, so a single retry is worth the latency.
        for attempt in range(2):
            system_msg = SYSTEM_PROMPT
            if attempt == 1:
                system_msg = (
                    SYSTEM_PROMPT
                    + "\n\nReturn ONLY a JSON object. No markdown, no code fences, no prose."
                )
            try:
                resp = await client.chat.completions.create(
                    model=FAST_MODEL,
                    max_tokens=400,
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": _build_user_prompt(metrics, debrief, coaching_points)},
                    ],
                    response_format={"type": "json_object"},
                )
                raw = (resp.choices[0].message.content or "").strip()
                # Some providers return json inside a fenced block even with
                # response_format=json_object — try both raw and stripped fences.
                try:
                    data = json.loads(raw)
                except Exception:
                    stripped = raw.strip("`\n")
                    if stripped.lower().startswith("json"):
                        stripped = stripped[4:].lstrip()
                    try:
                        data = json.loads(stripped)
                    except Exception:
                        # Last-ditch: regex for the outermost {...}
                        import re as _re
                        m = _re.search(r"\{[\s\S]*\}", raw)
                        if m:
                            data = json.loads(m.group(0))
                if data is not None:
                    break
            except Exception as e:
                last_err = e
        if data is None:
            if last_err:
                print(f"[plans] LLM call failed after retry: {last_err}")
            return None
        print(f"[plans] LLM returned {len(data.get('items') or [])} items")
        for it in (data.get("items") or [])[:5]:
            metric = str(it.get("target_metric", "")).strip()
            # Normalize near-matches: "best_lap" → "best_lap_ms" etc.
            if metric and metric not in SUPPORTED_METRICS:
                for canon in SUPPORTED_METRICS:
                    if canon.startswith(metric) or metric.startswith(canon.rsplit("_", 1)[0]):
                        metric = canon
                        break
            text = str(it.get("item_text", "")).strip()
            if not text:
                continue
            # target_value is informational — store even if we can't coerce,
            # so the item still renders and the user sees the guidance.
            try:
                target = float(it.get("target_value"))
            except Exception:
                target = None
            items.append({
                "item_text": text[:200],
                "target_metric": metric or "general",
                "target_value": target if target is not None else 0.0,
            })
    finally:
        try:
            await client.close()
        except Exception:
            pass

    if not items:
        return None
    plan_id = await _persist_plan(session_id, items)
    return {"plan_id": plan_id, "items": items}


async def _persist_plan(session_id: str, items: list[dict]) -> int:
    db = await get_db()
    try:
        # Upsert plan
        cur = await db.execute(
            "INSERT INTO coaching_plans (session_id) VALUES (?) "
            "ON CONFLICT(session_id) DO UPDATE SET created_at = datetime('now')",
            (session_id,),
        )
        cur = await db.execute(
            "SELECT id FROM coaching_plans WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        plan_id = int(row["id"])
        await db.execute(
            "DELETE FROM coaching_focus_items WHERE plan_id = ?", (plan_id,)
        )
        await db.executemany(
            """INSERT INTO coaching_focus_items
               (plan_id, item_text, target_metric, target_value, status)
               VALUES (?, ?, ?, ?, 'open')""",
            [(plan_id, it["item_text"], it["target_metric"], it["target_value"]) for it in items],
        )
        await db.commit()
    finally:
        await db.close()
    return plan_id


# ---------------------------------------------------------------------------
# Memory: evaluate the prior session's plan against the current one
# ---------------------------------------------------------------------------


async def _find_prior_session(session_id: str) -> Optional[str]:
    """The most recent earlier session by the same driver/venue/vehicle."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT driver, venue, vehicle, log_date FROM sessions WHERE id = ?",
            (session_id,),
        )
        cur_row = await cur.fetchone()
        if not cur_row:
            return None
        cur = await db.execute(
            """SELECT id FROM sessions
               WHERE id != ?
                 AND driver = ?
                 AND venue = ?
                 AND vehicle = ?
                 AND (log_date < ? OR log_date IS NULL OR log_date = '')
               ORDER BY log_date DESC LIMIT 1""",
            (
                session_id,
                cur_row["driver"] or "",
                cur_row["venue"] or "",
                cur_row["vehicle"] or "",
                cur_row["log_date"] or "9999-99-99",
            ),
        )
        row = await cur.fetchone()
        return row["id"] if row else None
    finally:
        await db.close()


async def evaluate_prior_plan(session_id: str) -> Optional[dict]:
    """Grade the previous session's open focus items against this session.

    Statuses set on each item: ``improved | same | worse``.
    Returns a small payload describing what was evaluated, or None.
    """
    prior = await _find_prior_session(session_id)
    if not prior:
        return None

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id FROM coaching_plans WHERE session_id = ?", (prior,)
        )
        plan_row = await cur.fetchone()
        if not plan_row:
            return None
        plan_id = int(plan_row["id"])
        cur = await db.execute(
            "SELECT id, item_text, target_metric, target_value, status "
            "FROM coaching_focus_items WHERE plan_id = ? AND status = 'open'",
            (plan_id,),
        )
        items = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    if not items:
        return None

    prior_metrics = await _extract_metrics(prior)
    new_metrics = await _extract_metrics(session_id)

    results: list[dict] = []
    EPS_PCT = 0.5  # 0.5% threshold for "same"
    for it in items:
        m = it["target_metric"]
        before = prior_metrics.get(m)
        after = new_metrics.get(m)
        target = it["target_value"]
        status = "same"
        delta = None
        if before is not None and after is not None and before != 0:
            delta = after - before
            change_pct = abs(delta) / abs(before) * 100.0
            if change_pct < EPS_PCT:
                status = "same"
            else:
                # Direction of "better"
                lower_is_better = LOWER_IS_BETTER.get(m, True)
                if (delta < 0 and lower_is_better) or (delta > 0 and not lower_is_better):
                    status = "improved"
                else:
                    status = "worse"

        results.append({
            "item_id": it["id"],
            "item_text": it["item_text"],
            "target_metric": m,
            "target_value": target,
            "before": before,
            "after": after,
            "delta": delta,
            "status": status,
        })

    # Persist evaluation back onto the prior plan's items
    db = await get_db()
    try:
        await db.executemany(
            "UPDATE coaching_focus_items SET status = ?, evaluation_json = ? WHERE id = ?",
            [(r["status"], json.dumps(r), r["item_id"]) for r in results],
        )
        await db.commit()
    finally:
        await db.close()

    return {
        "prior_session_id": prior,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Read endpoint helpers
# ---------------------------------------------------------------------------


async def get_plan(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, created_at FROM coaching_plans WHERE session_id = ?",
            (session_id,),
        )
        prow = await cur.fetchone()
        if not prow:
            return None
        plan_id = int(prow["id"])
        cur = await db.execute(
            "SELECT id, item_text, target_metric, target_value, status, evaluation_json "
            "FROM coaching_focus_items WHERE plan_id = ? ORDER BY id",
            (plan_id,),
        )
        items = [dict(r) for r in await cur.fetchall()]
        for it in items:
            ev = it.pop("evaluation_json", None)
            if ev:
                try:
                    it["evaluation"] = json.loads(ev)
                except Exception:
                    it["evaluation"] = None
    finally:
        await db.close()

    return {
        "plan_id": plan_id,
        "session_id": session_id,
        "created_at": prow["created_at"],
        "items": items,
    }


async def get_prior_plan_results(session_id: str) -> Optional[dict]:
    """The PRIOR session's plan with its (now-evaluated) items, for the
    'last session's focus → results' UI block.
    """
    prior = await _find_prior_session(session_id)
    if not prior:
        return None
    plan = await get_plan(prior)
    if not plan:
        return None
    plan["prior_session_id"] = prior
    return plan
