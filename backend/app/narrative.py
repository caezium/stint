"""
LLM-generated session debrief narrative (T1.1).

After the statistical debrief is computed, this module asks Claude to write a
2–3 sentence headline plus 3 action items. The narrative is persisted into the
existing `debriefs.payload_json` under the `narrative` key, so it is exposed
via the same `GET /api/debrief/{session_id}` endpoint the UI already calls.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from .database import get_db
from .llm_client import FAST_MODEL, make_client


def _fmt_lap(ms: Optional[int]) -> str:
    if not ms:
        return "—"
    total = ms / 1000.0
    m = int(total // 60)
    s = total - m * 60
    return f"{m}:{s:06.3f}"


def _build_prompt(debrief: dict) -> str:
    meta = debrief.get("meta") or {}
    cons = debrief.get("lap_consistency") or {}
    sectors = debrief.get("sector_consistency") or []
    fp = debrief.get("driving_fingerprint") or {}
    trend = debrief.get("session_trend") or {}

    cov = cons.get("coefficient_of_variation")
    cov_str = f"{cov*100:.1f}%" if cov else "—"

    sector_lines = []
    for s in sectors[:6]:
        sector_lines.append(
            f"  S{s.get('sector_num')}: best {_fmt_lap(s.get('best_ms'))}, "
            f"σ {s.get('stddev_ms', 0)} ms"
        )

    return (
        f"Driver: {meta.get('driver', '')}\n"
        f"Venue: {meta.get('venue', '')}\n"
        f"Vehicle: {meta.get('vehicle', '')}\n"
        f"Laps: {cons.get('lap_count', 0)} (clean: {cons.get('clean_lap_count', 0)})\n"
        f"Best lap: {_fmt_lap(cons.get('best_ms'))}\n"
        f"Mean lap (clean): {_fmt_lap(cons.get('mean_ms'))}\n"
        f"Lap COV: {cov_str}\n"
        f"Best streak (within 1%): {cons.get('best_streak', 0)} laps\n"
        f"\nSectors:\n" + ("\n".join(sector_lines) or "  (no sectors)") + "\n"
        f"\nDriving fingerprint:\n"
        f"  throttle smoothness: {fp.get('throttle_smoothness', '—')}\n"
        f"  braking aggressiveness: {fp.get('braking_aggressiveness', '—')}\n"
        f"  steering smoothness: {fp.get('steering_smoothness', '—')}\n"
        f"  max brake: {fp.get('max_brake', '—')}\n"
        f"\nSession trend: {trend.get('insight', '—')}\n"
    )


SYSTEM = (
    "You are Stint, a racing telemetry coach. Given a structured stats payload "
    "for one session, produce JSON of the form "
    "{\"summary\": str, \"action_items\": [str, str, str]}. "
    "summary: 2 short sentences, max 60 words, conversational, no greetings. "
    "action_items: 3 imperative phrases, max 12 words each, each prescribing "
    "ONE concrete focus for next session. No fluff. No lap-time predictions."
)


async def generate_and_persist_narrative(session_id: str, debrief: dict) -> None:
    """Best-effort: write {summary, action_items} into the debrief payload.

    Sets narrative.status = 'ready' on success or 'failed' on any error.
    """
    import traceback
    status = "failed"
    summary = ""
    action_items: list[str] = []

    try:
        client = await make_client()
        if client is None:
            print(f"[narrative] no client for {session_id} (missing OpenRouter key)")
        else:
            try:
                resp = await client.chat.completions.create(
                    model=FAST_MODEL,
                    max_tokens=300,
                    messages=[
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": _build_prompt(debrief)},
                    ],
                )
                raw = (resp.choices[0].message.content or "").strip()
                # Strip ```json fences if present
                if raw.startswith("```"):
                    raw = raw.strip("`\n")
                    if raw.lower().startswith("json"):
                        raw = raw[4:].lstrip()
                print(f"[narrative] raw response for {session_id}: {raw[:300]}")
                try:
                    data = json.loads(raw)
                except Exception:
                    # Try extracting first {...} block from the text
                    import re
                    m = re.search(r"\{[\s\S]*\}", raw)
                    if not m:
                        raise
                    data = json.loads(m.group(0))
                summary = str(data.get("summary", "")).strip()
                items = data.get("action_items") or []
                if isinstance(items, list):
                    action_items = [str(x).strip() for x in items if str(x).strip()][:5]
                if summary or action_items:
                    status = "ready"
                print(f"[narrative] {session_id} status={status} items={len(action_items)}")
            finally:
                try:
                    await client.close()
                except Exception:
                    pass
    except Exception as e:
        print(f"[narrative] {session_id} failed: {type(e).__name__}: {e}")
        traceback.print_exc()
        status = "failed"

    await _patch_narrative(session_id, status, summary, action_items)


async def _patch_narrative(
    session_id: str, status: str, summary: str, action_items: list[str]
) -> None:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT payload_json FROM debriefs WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        if not row:
            return
        try:
            payload: dict[str, Any] = json.loads(row["payload_json"])
        except Exception:
            return
        payload["narrative"] = {
            "status": status,
            "summary": summary,
            "action_items": action_items,
        }
        await db.execute(
            "UPDATE debriefs SET payload_json = ?, generated_at = datetime('now') "
            "WHERE session_id = ?",
            (json.dumps(payload), session_id),
        )
        await db.commit()
    finally:
        await db.close()
