"""
Auto-debrief: structured post-session intelligence.

Produces a compact JSON summary that answers "how was my session?" — lap
consistency, sector consistency, corner performance heatmap, weather
correlation, and a driving-style fingerprint. Pure statistics, no LLM.

Entry point: ``generate_debrief(session_id)``.
"""

from __future__ import annotations

import json
import math
import statistics
from typing import Any, Optional

import numpy as np

from .database import get_db
from .xrk_service import get_resampled_lap_data


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def _fetch_racing_laps(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, duration_ms FROM laps "
            "WHERE session_id = ? AND num > 0 AND duration_ms > 0 ORDER BY num",
            (session_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


async def _fetch_sector_times(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT lap_num, sector_num, duration_ms FROM sector_times "
            "WHERE session_id = ? ORDER BY lap_num, sector_num",
            (session_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


async def _fetch_log_sheet(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT weather, track_temp, air_temp, tire_pressures_json, "
            "setup_notes, fuel_level, driver_rating, updated_at "
            "FROM session_log_sheets WHERE session_id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def _fetch_session_meta(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, driver, vehicle, venue, log_date, best_lap_time_ms, lap_count "
            "FROM sessions WHERE id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Compute blocks
# ---------------------------------------------------------------------------


def compute_lap_consistency(laps: list[dict]) -> dict:
    """Stddev / coefficient of variation across racing laps (outliers dropped)."""
    if len(laps) < 2:
        return {
            "lap_count": len(laps),
            "best_ms": int(laps[0]["duration_ms"]) if laps else None,
            "mean_ms": None,
            "stddev_ms": None,
            "coefficient_of_variation": None,
            "best_streak": 0,
            "clean_lap_count": 0,
        }

    durations = [l["duration_ms"] for l in laps]
    best = min(durations)
    clean = [d for d in durations if d <= best * 1.15]

    mean_clean = statistics.fmean(clean) if clean else None
    stddev_clean = statistics.pstdev(clean) if len(clean) >= 2 else None
    cov = (stddev_clean / mean_clean) if (mean_clean and stddev_clean is not None and mean_clean > 0) else None

    # Best streak: longest run of consecutive laps within 1% of best
    streak, best_streak = 0, 0
    for d in durations:
        if d <= best * 1.01:
            streak += 1
            best_streak = max(best_streak, streak)
        else:
            streak = 0

    return {
        "lap_count": len(durations),
        "best_ms": int(best),
        "mean_ms": int(mean_clean) if mean_clean else None,
        "stddev_ms": int(stddev_clean) if stddev_clean is not None else None,
        "coefficient_of_variation": round(cov, 4) if cov is not None else None,
        "best_streak": best_streak,
        "clean_lap_count": len(clean),
    }


def compute_sector_consistency(sector_times: list[dict]) -> list[dict]:
    """Per-sector stddev across laps, and best-sector time."""
    by_sector: dict[int, list[int]] = {}
    for st in sector_times:
        by_sector.setdefault(st["sector_num"], []).append(int(st["duration_ms"]))

    out: list[dict] = []
    for sn in sorted(by_sector):
        vals = by_sector[sn]
        if len(vals) < 2:
            continue
        best = min(vals)
        clean = [v for v in vals if v <= best * 1.15]
        mean_c = statistics.fmean(clean) if clean else None
        stddev_c = statistics.pstdev(clean) if len(clean) >= 2 else None
        out.append({
            "sector_num": sn,
            "best_ms": best,
            "mean_ms": int(mean_c) if mean_c else None,
            "stddev_ms": int(stddev_c) if stddev_c is not None else None,
        })
    return out


def compute_corner_performance(
    sector_times: list[dict], laps: list[dict]
) -> list[dict]:
    """Score each sector 0–100 by your own consistency within that sector.

    100 = tight cluster around best. 0 = highly variable. Only makes sense
    when sectors are defined. Returns empty list otherwise.
    """
    if not sector_times:
        return []

    # Group sector times by sector_num
    by_sector: dict[int, list[int]] = {}
    for st in sector_times:
        by_sector.setdefault(st["sector_num"], []).append(int(st["duration_ms"]))

    out: list[dict] = []
    for sn in sorted(by_sector):
        vals = by_sector[sn]
        if len(vals) < 2:
            continue
        best = min(vals)
        arr = np.array(vals, dtype=np.float64)
        # Drop obvious traffic outliers (> 15% slower than best)
        clean = arr[arr <= best * 1.15]
        if len(clean) < 2:
            continue
        mean_c = float(np.mean(clean))
        std_c = float(np.std(clean))

        # Score: penalize both being far from best (delta%) and being inconsistent (cov%).
        delta_pct = (mean_c - best) / best * 100 if best > 0 else 0.0
        cov_pct = (std_c / mean_c) * 100 if mean_c > 0 else 0.0
        # Linear score: subtract weighted penalties, clamp to [0,100]
        score = 100 - (delta_pct * 8) - (cov_pct * 10)
        score = max(0.0, min(100.0, score))

        out.append({
            "sector_num": sn,
            "best_ms": int(best),
            "mean_ms": int(mean_c),
            "stddev_ms": int(std_c),
            "delta_to_best_pct": round(delta_pct, 2),
            "cov_pct": round(cov_pct, 2),
            "score": round(score, 1),
        })
    return out


def compute_session_trend(
    laps: list[dict], log_sheet: Optional[dict]
) -> Optional[dict]:
    """Lap-index → lap-time trend. Single-point weather is included as
    context only — it can't correlate per-lap so we don't pretend it does.
    (Renamed from ``compute_weather_correlation`` in T1.8.)
    """
    if len(laps) < 3:
        return None

    durations = np.array([l["duration_ms"] for l in laps], dtype=np.float64)
    idx = np.arange(len(durations), dtype=np.float64)

    if float(np.std(durations)) < 1e-6:
        return None

    # Pearson correlation: lap index vs lap time
    r_matrix = np.corrcoef(idx, durations)
    r = float(r_matrix[0, 1]) if not math.isnan(r_matrix[0, 1]) else 0.0
    slope = float(np.polyfit(idx, durations, 1)[0])

    insight = ""
    if slope > 100 and r > 0.5:
        insight = (
            f"Lap times got slower by {slope:.0f}ms/lap over the session — "
            "possible tire deg, fuel/temp drift, or fatigue."
        )
    elif slope < -100 and r < -0.5:
        insight = (
            f"Lap times got faster by {-slope:.0f}ms/lap — you were learning "
            "the track or the car came into its window."
        )
    else:
        insight = "No strong lap-over-lap trend."

    weather_ctx = {
        "weather": (log_sheet or {}).get("weather", ""),
        "track_temp": (log_sheet or {}).get("track_temp", 0) or None,
        "air_temp": (log_sheet or {}).get("air_temp", 0) or None,
    }

    return {
        "lap_trend_slope_ms_per_lap": round(slope, 1),
        "lap_trend_r": round(r, 3),
        "insight": insight,
        "weather_context": weather_ctx,
    }


# Backwards-compat alias for any legacy import path.
compute_weather_correlation = compute_session_trend


def _safe_channel_match(names: list[str], needles: list[str]) -> Optional[str]:
    low = {c.lower(): c for c in names}
    for n in needles:
        nl = n.lower()
        for lk, orig in low.items():
            if nl in lk:
                return orig
    return None


def compute_driving_fingerprint(
    session_id: str, lap_num: int, channel_names: list[str]
) -> Optional[dict]:
    """Smoothness / aggressiveness scalars for one lap (T2.4 per-lap variant).

    * braking_aggressiveness = median abs(d/dt brake_pressure or brake)
    * throttle_smoothness    = 1 / (1 + stddev of d/dt throttle%)  → 0..1
    * steering_smoothness    = 1 / (1 + stddev of d/dt steering)   → 0..1
    """
    throttle_ch = _safe_channel_match(channel_names, ["TPS", "Throttle"])
    brake_ch = _safe_channel_match(channel_names, ["BrakePress", "Brake"])
    steer_ch = _safe_channel_match(channel_names, ["Steering", "Steer"])

    wanted = [c for c in (throttle_ch, brake_ch, steer_ch) if c]
    if not wanted:
        return None

    table = get_resampled_lap_data(session_id, wanted, lap_num)
    if table is None or table.num_rows < 50:
        return None

    tc = np.array(table.column("timecodes").to_pylist(), dtype=np.float64)
    if len(tc) < 2:
        return None
    dt_ms = np.maximum(np.diff(tc), 1.0)

    out: dict[str, Any] = {}

    if throttle_ch and throttle_ch in table.column_names:
        y = np.array(table.column(throttle_ch).to_pylist(), dtype=np.float64)
        dy = np.diff(y) / (dt_ms / 1000.0)
        out["throttle_smoothness"] = round(float(1.0 / (1.0 + float(np.std(dy)))), 3)

    if brake_ch and brake_ch in table.column_names:
        y = np.array(table.column(brake_ch).to_pylist(), dtype=np.float64)
        dy = np.diff(y) / (dt_ms / 1000.0)
        out["braking_aggressiveness"] = round(float(np.median(np.abs(dy))), 3)
        out["max_brake"] = round(float(np.max(y)), 2)

    if steer_ch and steer_ch in table.column_names:
        y = np.array(table.column(steer_ch).to_pylist(), dtype=np.float64)
        dy = np.diff(y) / (dt_ms / 1000.0)
        out["steering_smoothness"] = round(float(1.0 / (1.0 + float(np.std(dy)))), 3)

    out["reference_lap"] = lap_num
    return out or None


async def compute_per_lap_fingerprints(
    session_id: str, racing_laps: list[dict], channel_names: list[str]
) -> list[dict]:
    """Compute and persist per-lap fingerprints (T2.4)."""
    out: list[dict] = []
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM lap_fingerprints WHERE session_id = ?", (session_id,)
        )
        rows = []
        for lap in racing_laps:
            fp = compute_driving_fingerprint(session_id, lap["num"], channel_names)
            if not fp:
                continue
            entry = {"lap_num": lap["num"], **fp}
            out.append(entry)
            rows.append(
                (
                    session_id,
                    lap["num"],
                    fp.get("throttle_smoothness"),
                    fp.get("braking_aggressiveness"),
                    fp.get("max_brake"),
                    fp.get("steering_smoothness"),
                )
            )
        if rows:
            await db.executemany(
                """INSERT OR REPLACE INTO lap_fingerprints
                   (session_id, lap_num, throttle_smoothness,
                    braking_aggressiveness, max_brake, steering_smoothness)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                rows,
            )
            await db.commit()
    finally:
        await db.close()
    return out


async def get_per_lap_fingerprints(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT lap_num, throttle_smoothness, braking_aggressiveness, "
            "max_brake, steering_smoothness FROM lap_fingerprints "
            "WHERE session_id = ? ORDER BY lap_num",
            (session_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


def _list_channels_in_cache(session_id: str) -> list[str]:
    import os
    from .xrk_service import CACHE_DIR
    cache_dir = os.path.join(CACHE_DIR, session_id)
    if not os.path.exists(cache_dir):
        return []
    out: list[str] = []
    for fname in os.listdir(cache_dir):
        if not fname.endswith(".arrow"):
            continue
        if fname.startswith("resampled_"):
            continue
        out.append(fname[: -len(".arrow")].replace("_", " "))
    return out


# ---------------------------------------------------------------------------
# Orchestration + caching
# ---------------------------------------------------------------------------


async def generate_debrief(session_id: str) -> dict:
    meta = await _fetch_session_meta(session_id)
    if not meta:
        return {
            "session_id": session_id,
            "error": "session_not_found",
        }

    laps = await _fetch_racing_laps(session_id)
    sector_times = await _fetch_sector_times(session_id)
    log_sheet = await _fetch_log_sheet(session_id)
    channels = _list_channels_in_cache(session_id)

    # Pick best lap (min duration)
    best_lap_num = None
    if laps:
        best_lap_num = min(laps, key=lambda l: l["duration_ms"])["num"]

    session_trend = compute_session_trend(laps, log_sheet)

    debrief = {
        "session_id": session_id,
        "meta": {
            "driver": meta.get("driver", ""),
            "vehicle": meta.get("vehicle", ""),
            "venue": meta.get("venue", ""),
            "log_date": meta.get("log_date", ""),
            "lap_count": meta.get("lap_count", 0),
            "best_lap_ms": int(meta.get("best_lap_time_ms") or 0) or None,
        },
        "lap_consistency": compute_lap_consistency(laps),
        "sector_consistency": compute_sector_consistency(sector_times),
        "corner_performance": compute_corner_performance(sector_times, laps),
        # T1.8: renamed key. Old `weather_correlation` kept as alias so the
        # frontend can read both during the migration window.
        "session_trend": session_trend,
        "weather_correlation": session_trend,
        "driving_fingerprint": (
            compute_driving_fingerprint(session_id, best_lap_num, channels)
            if best_lap_num is not None
            else None
        ),
        # T1.1: narrative is generated async after stats land. Default to
        # 'pending' so the UI can shimmer; the narrative writer flips it to
        # 'ready' (and fills `narrative.summary`/`action_items`) when done.
        "narrative": {"status": "pending", "summary": "", "action_items": []},
    }

    # T2.4: per-lap fingerprints (also feeds T3.4 benchmarks)
    try:
        await compute_per_lap_fingerprints(session_id, laps, channels)
    except Exception as e:
        print(f"[debrief] per-lap fingerprint failed for {session_id}: {e}")

    # Persist the stats payload first so the UI has something to render
    await _persist_debrief(session_id, debrief)

    # T1.1: narrative generation used to be fire-and-forget, which meant a
    # failure inside the task was silently swallowed and the user had to hit
    # "Regenerate debrief" to see anything. We now `await` it and persist
    # the narrative's status so the UI can show a proper error + retry pill.
    try:
        from . import narrative as _narrative
        await _narrative.generate_and_persist_narrative(session_id, debrief)
    except Exception as e:
        print(f"[debrief] narrative generation failed for {session_id}: {e}")
        # Flip status to 'error' so the UI stops shimmering and shows a retry.
        try:
            debrief["narrative"] = {
                "status": "error",
                "summary": "",
                "action_items": [],
                "error": str(e)[:200],
            }
            await _persist_debrief(session_id, debrief)
        except Exception:
            pass

    return debrief


async def _persist_debrief(session_id: str, payload: dict) -> None:
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO debriefs (session_id, payload_json, generated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(session_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 generated_at = excluded.generated_at""",
            (session_id, json.dumps(payload)),
        )
        await db.commit()
    finally:
        await db.close()


async def get_cached_debrief(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT payload_json, generated_at FROM debriefs WHERE session_id = ?",
            (session_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            return None
        payload["_generated_at"] = row["generated_at"]
        return payload
    finally:
        await db.close()
