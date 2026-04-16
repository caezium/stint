"""
Tool schemas + dispatcher for the Claude-powered chat agent.

Schemas are in OpenAI function-calling format (OpenRouter passes them
through to Anthropic and other providers transparently).

The dispatcher calls internal Python functions directly (not HTTP
self-calls) so we avoid the round-trip cost and keep error handling simple.

All tools operate within a fixed session_id context supplied by the caller —
the LLM never has to pass session_id itself. This also prevents the model
from fishing around in other users' sessions.
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from .database import get_db
from .xrk_service import get_resampled_lap_data


# ---------------------------------------------------------------------------
# Tool schemas (Anthropic tool-use format)
# ---------------------------------------------------------------------------

def _fn(name: str, description: str, parameters: dict) -> dict:
    """Build an OpenAI-format function-tool spec."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


TOOL_SCHEMAS: list[dict] = [
    _fn(
        "get_session_overview",
        (
            "Get high-level metadata for the current session: driver, vehicle, "
            "venue, lap count, best lap, and the list of available data channels. "
            "Call this first when the user asks a general question about their session."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "list_laps",
        (
            "List all laps in the current session with their durations and "
            "split/sector times. Use this to find the best lap, the slowest lap, "
            "or understand pacing."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "get_lap_stats",
        (
            "Get min/max/mean/stddev/percentile statistics for one or more channels "
            "on a specific lap. Useful for comparing how a driver performed at, e.g., "
            "max speed or peak brake pressure."
        ),
        {
            "type": "object",
            "properties": {
                "lap_num": {"type": "integer", "description": "Lap number (>= 1)"},
                "channels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Channel names like 'RPM', 'GPS Speed', 'Brake', 'TPS'.",
                },
            },
            "required": ["lap_num", "channels"],
        },
    ),
    _fn(
        "compare_laps_delta",
        (
            "Compute a distance-domain time delta between two laps in the current "
            "session. Returns a summary of where the compare lap was faster or "
            "slower, including total gap and peak gain/loss locations."
        ),
        {
            "type": "object",
            "properties": {
                "ref_lap": {"type": "integer", "description": "Reference lap number."},
                "compare_lap": {"type": "integer", "description": "Lap to compare."},
            },
            "required": ["ref_lap", "compare_lap"],
        },
    ),
    _fn(
        "get_sector_times",
        (
            "Return sector definitions and per-lap split times for the current "
            "session. Includes the theoretical best lap (sum of best sectors)."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "get_anomalies",
        (
            "Return the list of automatically-detected anomalies for the session — "
            "cooling trends, brake fade, voltage sag, sensor drift, RPM dropouts, etc."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "get_debrief",
        (
            "Return the auto-generated structured session debrief with consistency "
            "metrics, corner performance scores, weather correlation, and driving "
            "fingerprint. Rich precomputed summary of the session."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "sample_channel_on_lap",
        (
            "Return a downsampled numeric sample of a single channel on a specific "
            "lap (about 60 points). Useful for spotting where in the lap something "
            "unusual happened — e.g., where the throttle lifts are, or where speed "
            "drops. Do not request more than 2–3 channels per turn — use get_lap_stats "
            "if you only need aggregate numbers."
        ),
        {
            "type": "object",
            "properties": {
                "lap_num": {"type": "integer"},
                "channel": {"type": "string"},
            },
            "required": ["lap_num", "channel"],
        },
    ),
]


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


async def _session_meta(session_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT id, driver, vehicle, venue, log_date, log_time,
                      lap_count, best_lap_time_ms, total_duration_ms
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def _channels(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT name, units, category FROM channels WHERE session_id = ? ORDER BY category, name",
            (session_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


async def _laps(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, duration_ms FROM laps "
            "WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


async def tool_get_session_overview(session_id: str) -> dict:
    meta = await _session_meta(session_id)
    if not meta:
        return {"error": "Session not found"}
    channels = await _channels(session_id)
    # Compact channels output: groups of (category, names[])
    by_cat: dict[str, list[str]] = {}
    for c in channels:
        by_cat.setdefault(c["category"], []).append(c["name"])
    return {
        "driver": meta["driver"],
        "vehicle": meta["vehicle"],
        "venue": meta["venue"],
        "log_date": meta["log_date"],
        "log_time": meta["log_time"],
        "lap_count": meta["lap_count"],
        "best_lap_time_ms": meta["best_lap_time_ms"],
        "total_duration_ms": meta["total_duration_ms"],
        "channel_count": len(channels),
        "channels_by_category": by_cat,
    }


async def tool_list_laps(session_id: str) -> dict:
    laps = await _laps(session_id)
    racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
    if not racing:
        return {"laps": laps, "best_lap": None, "slowest_lap": None}
    best = min(racing, key=lambda l: l["duration_ms"])
    slowest = max(racing, key=lambda l: l["duration_ms"])
    return {
        "laps": laps,
        "best_lap": best,
        "slowest_lap": slowest,
        "racing_lap_count": len(racing),
    }


async def tool_get_lap_stats(session_id: str, lap_num: int, channels: list[str]) -> dict:
    table = get_resampled_lap_data(session_id, channels, lap_num)
    if table is None or table.num_rows == 0:
        return {"error": f"No data for lap {lap_num} with channels {channels}"}

    out: dict[str, Any] = {"lap_num": lap_num, "sample_count": table.num_rows, "channels": {}}
    for ch in channels:
        if ch not in table.column_names:
            out["channels"][ch] = {"error": "Channel not available"}
            continue
        try:
            arr = np.array(table.column(ch).to_pylist(), dtype=np.float64)
            arr = arr[np.isfinite(arr)]
            if arr.size == 0:
                out["channels"][ch] = {"error": "No finite samples"}
                continue
            out["channels"][ch] = {
                "min": round(float(np.min(arr)), 3),
                "max": round(float(np.max(arr)), 3),
                "mean": round(float(np.mean(arr)), 3),
                "stddev": round(float(np.std(arr)), 3),
                "p5": round(float(np.percentile(arr, 5)), 3),
                "p50": round(float(np.percentile(arr, 50)), 3),
                "p95": round(float(np.percentile(arr, 95)), 3),
            }
        except Exception as e:
            out["channels"][ch] = {"error": str(e)}
    return out


def _haversine_cumdist(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    R = 6371000.0
    if len(lats) < 2:
        return np.zeros(len(lats))
    dlat = np.diff(np.radians(lats))
    dlon = np.diff(np.radians(lons))
    lat1 = np.radians(lats[:-1])
    lat2 = np.radians(lats[1:])
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    seg = R * c
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    return cum


async def tool_compare_laps_delta(session_id: str, ref_lap: int, compare_lap: int) -> dict:
    """Distance-domain time delta: for each point on the track, how far ahead
    or behind was the compare lap vs the reference lap?"""
    gps = ["GPS Latitude", "GPS Longitude"]
    ref_table = get_resampled_lap_data(session_id, gps, ref_lap)
    cmp_table = get_resampled_lap_data(session_id, gps, compare_lap)
    if ref_table is None or cmp_table is None:
        return {"error": "Missing GPS data for one or both laps"}
    if "GPS Latitude" not in ref_table.column_names:
        return {"error": "No GPS Latitude channel"}

    ref_lats = np.array(ref_table.column("GPS Latitude").to_pylist(), dtype=np.float64)
    ref_lons = np.array(ref_table.column("GPS Longitude").to_pylist(), dtype=np.float64)
    ref_tc = np.array(ref_table.column("timecodes").to_pylist(), dtype=np.float64)
    cmp_lats = np.array(cmp_table.column("GPS Latitude").to_pylist(), dtype=np.float64)
    cmp_lons = np.array(cmp_table.column("GPS Longitude").to_pylist(), dtype=np.float64)
    cmp_tc = np.array(cmp_table.column("timecodes").to_pylist(), dtype=np.float64)

    ref_d = _haversine_cumdist(ref_lats, ref_lons)
    cmp_d = _haversine_cumdist(cmp_lats, cmp_lons)

    # Normalize timecodes to start at 0
    ref_t = ref_tc - ref_tc[0]
    cmp_t = cmp_tc - cmp_tc[0]

    # Sample ~100 points along the shorter of the two track distances
    common = min(ref_d[-1], cmp_d[-1])
    if common <= 0:
        return {"error": "Zero distance laps"}
    sample_d = np.linspace(0, common, 100)
    ref_t_at_d = np.interp(sample_d, ref_d, ref_t)
    cmp_t_at_d = np.interp(sample_d, cmp_d, cmp_t)
    delta_ms = cmp_t_at_d - ref_t_at_d  # positive = compare slower

    total_gap_ms = float(delta_ms[-1])
    max_loss_idx = int(np.argmax(delta_ms))
    max_gain_idx = int(np.argmin(delta_ms))

    return {
        "ref_lap": ref_lap,
        "compare_lap": compare_lap,
        "total_gap_ms": round(total_gap_ms, 1),
        "peak_loss_ms": round(float(delta_ms[max_loss_idx]), 1),
        "peak_loss_distance_m": round(float(sample_d[max_loss_idx]), 1),
        "peak_loss_distance_pct": round(float(sample_d[max_loss_idx] / common * 100), 1),
        "peak_gain_ms": round(float(delta_ms[max_gain_idx]), 1),
        "peak_gain_distance_m": round(float(sample_d[max_gain_idx]), 1),
        "peak_gain_distance_pct": round(float(sample_d[max_gain_idx] / common * 100), 1),
        "track_distance_m": round(float(common), 1),
        "note": "Positive delta means the compare lap was slower at that point.",
    }


async def tool_get_sector_times(session_id: str) -> dict:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT sector_num, start_distance_m, end_distance_m, label "
            "FROM sectors WHERE session_id = ? ORDER BY sector_num",
            (session_id,),
        )
        sectors = [dict(r) for r in await cursor.fetchall()]
        cursor = await db.execute(
            "SELECT lap_num, sector_num, duration_ms FROM sector_times "
            "WHERE session_id = ? ORDER BY lap_num, sector_num",
            (session_id,),
        )
        times = [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()

    by_sector_best: dict[int, int] = {}
    for t in times:
        sn = t["sector_num"]
        if sn not in by_sector_best or t["duration_ms"] < by_sector_best[sn]:
            by_sector_best[sn] = t["duration_ms"]
    theoretical_best_ms = sum(by_sector_best.values()) if by_sector_best else None

    return {
        "sectors": sectors,
        "sector_times": times,
        "theoretical_best_ms": theoretical_best_ms,
        "best_sectors_ms": by_sector_best,
    }


async def tool_get_anomalies(session_id: str) -> dict:
    from .anomalies import get_session_anomalies, get_anomaly_counts
    items = await get_session_anomalies(session_id)
    counts = await get_anomaly_counts(session_id)
    return {"counts": counts, "items": items}


async def tool_get_debrief(session_id: str) -> dict:
    from .debrief import get_cached_debrief, generate_debrief
    cached = await get_cached_debrief(session_id)
    if cached:
        return cached
    return await generate_debrief(session_id)


async def tool_sample_channel_on_lap(
    session_id: str, lap_num: int, channel: str
) -> dict:
    table = get_resampled_lap_data(session_id, [channel], lap_num)
    if table is None or table.num_rows == 0:
        return {"error": f"No data for channel '{channel}' on lap {lap_num}"}
    if channel not in table.column_names:
        return {"error": f"Channel '{channel}' not present on lap {lap_num}"}

    values = np.array(table.column(channel).to_pylist(), dtype=np.float64)
    tc = np.array(table.column("timecodes").to_pylist(), dtype=np.float64)
    if len(tc) == 0:
        return {"error": "Empty lap"}

    # Downsample to ~60 points
    n = 60
    if len(values) > n:
        idx = np.linspace(0, len(values) - 1, n).astype(int)
        values = values[idx]
        tc = tc[idx]
    tc = tc - tc[0]  # lap-relative ms

    return {
        "lap_num": lap_num,
        "channel": channel,
        "units": "",
        "samples": [
            {"t_ms": int(t), "value": round(float(v), 3)}
            for t, v in zip(tc, values)
            if math.isfinite(v)
        ],
    }


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


async def execute_tool(name: str, input: dict, session_id: str) -> dict:
    """Run a tool by name. Always returns a JSON-serializable dict."""
    try:
        if name == "get_session_overview":
            return await tool_get_session_overview(session_id)
        if name == "list_laps":
            return await tool_list_laps(session_id)
        if name == "get_lap_stats":
            return await tool_get_lap_stats(
                session_id,
                int(input["lap_num"]),
                list(input.get("channels", [])),
            )
        if name == "compare_laps_delta":
            return await tool_compare_laps_delta(
                session_id,
                int(input["ref_lap"]),
                int(input["compare_lap"]),
            )
        if name == "get_sector_times":
            return await tool_get_sector_times(session_id)
        if name == "get_anomalies":
            return await tool_get_anomalies(session_id)
        if name == "get_debrief":
            return await tool_get_debrief(session_id)
        if name == "sample_channel_on_lap":
            return await tool_sample_channel_on_lap(
                session_id,
                int(input["lap_num"]),
                str(input["channel"]),
            )
        return {"error": f"Unknown tool: {name}"}
    except KeyError as e:
        return {"error": f"Missing required input field: {e}"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
