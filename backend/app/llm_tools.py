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
    _fn(
        "get_coaching_points",
        (
            "Return prescriptive coaching points (braking-on distance, apex speed, "
            "throttle pickup) per (lap, sector) for the current session, plus "
            "deltas vs the per-sector best lap. Use this when the user asks how "
            "to be faster or where they're losing time within a corner."
        ),
        {
            "type": "object",
            "properties": {
                "lap_num": {"type": "integer"},
                "sector_num": {"type": "integer"},
            },
            "required": [],
        },
    ),
    _fn(
        "get_fingerprint_evolution",
        (
            "Return per-lap driving fingerprint metrics (throttle/steering "
            "smoothness, brake aggressiveness) so you can spot trends across the "
            "stint — fatigue, rising aggression, etc."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "find_similar_sessions",
        (
            "List other sessions in the local archive matching optional filters. "
            "Defaults to the current session's venue+vehicle. Use to find prior "
            "outings to compare against."
        ),
        {
            "type": "object",
            "properties": {
                "venue": {"type": "string"},
                "vehicle": {"type": "string"},
                "driver": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    ),
    _fn(
        "compare_sessions",
        (
            "Compare another session against the current one: best-lap delta, "
            "per-sector best deltas, fingerprint diff. Read-only. The other "
            "session id comes from find_similar_sessions or get_session_history."
        ),
        {
            "type": "object",
            "properties": {"other_session_id": {"type": "string"}},
            "required": ["other_session_id"],
        },
    ),
    _fn(
        "personal_best_sector",
        (
            "Find the driver's all-time best time in a given sector at a given "
            "venue. Returns session_id, lap_num, time_ms."
        ),
        {
            "type": "object",
            "properties": {
                "venue": {"type": "string"},
                "sector_num": {"type": "integer"},
                "driver": {"type": "string"},
            },
            "required": ["sector_num"],
        },
    ),
    _fn(
        "get_session_history",
        (
            "List the driver's recent sessions (with venue, vehicle, best lap, "
            "tags) so you can reason about progression. Defaults to the current "
            "session's driver."
        ),
        {
            "type": "object",
            "properties": {
                "driver": {"type": "string"},
                "venue": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    ),
    _fn(
        "list_layouts",
        (
            "List saved chart layouts. Use as a precursor to apply_layout if the "
            "user asks for a saved view."
        ),
        {"type": "object", "properties": {}, "required": []},
    ),
    _fn(
        "apply_layout",
        (
            "Save a new chart layout and surface it for the user to apply. The "
            "user must click 'apply' before it activates — the tool only stores "
            "the proposal. Provide a short name and a list of chart specs."
        ),
        {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "charts": {"type": "array"},
            },
            "required": ["name", "charts"],
        },
    ),
    _fn(
        "apply_math_channel",
        (
            "Propose a math channel (an arithmetic expression of existing "
            "channels) that would clarify the analysis. Same two-step UX as "
            "apply_layout — the user confirms before it lands."
        ),
        {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "expression": {"type": "string"},
            },
            "required": ["name", "expression"],
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
# T2.1 / T2.2 / T4.x — newer tools
# ---------------------------------------------------------------------------


async def tool_get_coaching_points(
    session_id: str, lap_num: Optional[int] = None, sector_num: Optional[int] = None
) -> dict:
    from .coaching import get_coaching_points
    pts = await get_coaching_points(session_id, lap_num, sector_num)
    return {"points": pts, "count": len(pts)}


async def tool_get_fingerprint_evolution(session_id: str) -> dict:
    from .debrief import get_per_lap_fingerprints
    rows = await get_per_lap_fingerprints(session_id)
    return {"laps": rows, "count": len(rows)}


async def _resolve_current_session_meta(session_id: str) -> dict:
    meta = await _session_meta(session_id) or {}
    return {
        "venue": meta.get("venue") or "",
        "vehicle": meta.get("vehicle") or "",
        "driver": meta.get("driver") or "",
    }


async def tool_find_similar_sessions(
    session_id: str,
    venue: Optional[str] = None,
    vehicle: Optional[str] = None,
    driver: Optional[str] = None,
    limit: int = 20,
) -> dict:
    cur_meta = await _resolve_current_session_meta(session_id)
    venue = venue or cur_meta["venue"]
    vehicle = vehicle or cur_meta["vehicle"]
    db = await get_db()
    try:
        clauses = ["id != ?"]
        params: list = [session_id]
        if venue:
            clauses.append("venue = ?")
            params.append(venue)
        if vehicle:
            clauses.append("vehicle = ?")
            params.append(vehicle)
        if driver:
            clauses.append("driver = ?")
            params.append(driver)
        sql = (
            "SELECT id, driver, vehicle, venue, log_date, lap_count, "
            "best_lap_time_ms FROM sessions WHERE "
            + " AND ".join(clauses)
            + " ORDER BY log_date DESC LIMIT ?"
        )
        params.append(int(limit))
        cur = await db.execute(sql, params)
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"sessions": rows, "filters": {"venue": venue, "vehicle": vehicle, "driver": driver}}


async def tool_compare_sessions(session_id: str, other_session_id: str) -> dict:
    if other_session_id == session_id:
        return {"error": "other_session_id is the current session"}
    a_meta = await _session_meta(session_id)
    b_meta = await _session_meta(other_session_id)
    if not b_meta:
        return {"error": "Other session not found"}

    db = await get_db()
    try:
        # Sector bests for both
        cur = await db.execute(
            "SELECT session_id, sector_num, MIN(duration_ms) AS best "
            "FROM sector_times WHERE session_id IN (?, ?) GROUP BY session_id, sector_num",
            (session_id, other_session_id),
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    a_best: dict[int, int] = {}
    b_best: dict[int, int] = {}
    for r in rows:
        if r["session_id"] == session_id:
            a_best[int(r["sector_num"])] = int(r["best"])
        else:
            b_best[int(r["sector_num"])] = int(r["best"])
    sector_deltas: list[dict] = []
    for sn in sorted(set(a_best) & set(b_best)):
        sector_deltas.append({
            "sector_num": sn,
            "current_best_ms": a_best[sn],
            "other_best_ms": b_best[sn],
            "delta_ms": a_best[sn] - b_best[sn],
        })

    a_lap = (a_meta or {}).get("best_lap_time_ms")
    b_lap = b_meta.get("best_lap_time_ms")
    return {
        "current": {
            "session_id": session_id,
            "venue": (a_meta or {}).get("venue"),
            "best_lap_ms": a_lap,
        },
        "other": {
            "session_id": other_session_id,
            "venue": b_meta.get("venue"),
            "log_date": b_meta.get("log_date"),
            "best_lap_ms": b_lap,
        },
        "best_lap_delta_ms": (a_lap - b_lap) if (a_lap and b_lap) else None,
        "sector_deltas": sector_deltas,
    }


async def tool_personal_best_sector(
    session_id: str,
    sector_num: int,
    venue: Optional[str] = None,
    driver: Optional[str] = None,
) -> dict:
    cur_meta = await _resolve_current_session_meta(session_id)
    venue = venue or cur_meta["venue"]
    driver = driver or cur_meta["driver"]
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT st.session_id, st.lap_num, st.duration_ms, s.log_date, s.driver
               FROM sector_times st JOIN sessions s ON s.id = st.session_id
               WHERE st.sector_num = ?
                 AND (? = '' OR s.venue = ?)
                 AND (? = '' OR s.driver = ?)
               ORDER BY st.duration_ms ASC LIMIT 1""",
            (int(sector_num), venue, venue, driver, driver),
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row:
        return {"error": "No sector times found for the given filters"}
    return {
        "sector_num": int(sector_num),
        "venue": venue,
        "driver": driver,
        "session_id": row["session_id"],
        "lap_num": int(row["lap_num"]),
        "time_ms": int(row["duration_ms"]),
        "log_date": row["log_date"],
        "is_current": row["session_id"] == session_id,
    }


async def tool_get_session_history(
    session_id: str,
    driver: Optional[str] = None,
    venue: Optional[str] = None,
    limit: int = 20,
) -> dict:
    cur_meta = await _resolve_current_session_meta(session_id)
    driver = driver or cur_meta["driver"]
    db = await get_db()
    try:
        clauses = []
        params: list = []
        if driver:
            clauses.append("driver = ?")
            params.append(driver)
        if venue:
            clauses.append("venue = ?")
            params.append(venue)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = (
            "SELECT id, driver, vehicle, venue, log_date, best_lap_time_ms, lap_count "
            "FROM sessions" + where +
            " ORDER BY log_date DESC LIMIT ?"
        )
        params.append(int(limit))
        cur = await db.execute(sql, params)
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"sessions": rows}


async def tool_list_layouts(session_id: str) -> dict:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, name, created_at FROM layouts ORDER BY created_at DESC LIMIT 50"
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {"layouts": rows}


async def tool_apply_layout(session_id: str, name: str, charts: list) -> dict:
    """Two-step UX: store the proposal but don't activate it. The frontend
    surfaces a 'preview & apply' card the user must click."""
    import json as _json
    if not name or not isinstance(charts, list):
        return {"error": "name and charts (list) are required"}
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO layouts (name, config_json, created_at) VALUES (?, ?, datetime('now'))",
            (f"[proposed] {name[:60]}", _json.dumps({"charts": charts, "proposed": True})),
        )
        new_id = cur.lastrowid
        await db.commit()
    finally:
        await db.close()
    return {
        "layout_id": new_id,
        "name": name,
        "status": "proposed",
        "note": "Layout stored as a proposal. The user must click Apply.",
    }


async def tool_apply_math_channel(
    session_id: str, name: str, expression: str
) -> dict:
    """Two-step: persist as a draft math channel for the user to confirm."""
    if not name or not expression:
        return {"error": "name and expression are required"}
    db = await get_db()
    try:
        # Store under user_settings as a JSON queue keyed by session_id so the
        # workspace can render the proposal banner.
        import json as _json
        key = f"math_proposal:{session_id}"
        cur = await db.execute(
            "SELECT value FROM user_settings WHERE key = ?", (key,)
        )
        row = await cur.fetchone()
        existing: list[dict] = []
        if row and row["value"]:
            try:
                existing = _json.loads(row["value"]) or []
            except Exception:
                existing = []
        existing.append({"name": name, "expression": expression, "status": "proposed"})
        await db.execute(
            "INSERT INTO user_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, _json.dumps(existing)),
        )
        await db.commit()
    finally:
        await db.close()
    return {
        "name": name,
        "expression": expression,
        "status": "proposed",
        "note": "Math channel stored as a proposal. The user must click Apply in the workspace.",
    }


# ---------------------------------------------------------------------------
# Tool result summaries (T1.4) — one-line description for the collapsed chip.
# ---------------------------------------------------------------------------


def _fmt_lap_time(ms: Optional[float]) -> str:
    if ms is None or not isinstance(ms, (int, float)) or ms <= 0:
        return "—"
    total = float(ms) / 1000.0
    m = int(total // 60)
    s = total - m * 60
    return f"{m}:{s:06.3f}"


def summarize_tool_result(name: str, input: dict, result: Any) -> str:
    """Compact one-liner for the collapsed tool chip. Best-effort, never raises."""
    if not isinstance(result, dict):
        return ""
    if result.get("error"):
        return f"error: {str(result['error'])[:60]}"

    try:
        if name == "get_session_overview":
            return (
                f"{result.get('lap_count', 0)} laps · "
                f"best {_fmt_lap_time(result.get('best_lap_time_ms'))} · "
                f"{result.get('channel_count', 0)} channels"
            )
        if name == "list_laps":
            best = result.get("best_lap") or {}
            return (
                f"{result.get('racing_lap_count', 0)} racing laps · "
                f"best L{best.get('num', '?')} {_fmt_lap_time(best.get('duration_ms'))}"
            )
        if name == "get_lap_stats":
            chans = result.get("channels") or {}
            parts = []
            for ch, st in list(chans.items())[:2]:
                if isinstance(st, dict) and "max" in st:
                    parts.append(f"{ch} max {st['max']}")
            return f"L{result.get('lap_num')}: " + " · ".join(parts) if parts else f"L{result.get('lap_num')}"
        if name == "compare_laps_delta":
            return (
                f"L{result.get('compare_lap')} vs L{result.get('ref_lap')}: "
                f"gap {result.get('total_gap_ms', 0):+.0f} ms · "
                f"peak loss {result.get('peak_loss_ms', 0):+.0f} ms @ "
                f"{result.get('peak_loss_distance_pct', 0):.0f}%"
            )
        if name == "get_sector_times":
            sectors = result.get("sectors") or []
            tb = result.get("theoretical_best_ms")
            return f"{len(sectors)} sectors · theo best {_fmt_lap_time(tb)}"
        if name == "get_anomalies":
            counts = result.get("counts") or {}
            return (
                f"{counts.get('critical', 0)} crit · "
                f"{counts.get('warning', 0)} warn · "
                f"{counts.get('info', 0)} info"
            )
        if name == "get_debrief":
            cov = (result.get("lap_consistency") or {}).get("coefficient_of_variation")
            return f"COV {cov*100:.1f}%" if cov is not None else "debrief"
        if name == "sample_channel_on_lap":
            n = len(result.get("samples") or [])
            return f"{n} samples of {result.get('channel')} on L{result.get('lap_num')}"
        if name == "get_coaching_points":
            return f"{result.get('count', 0)} coaching points"
        if name == "get_fingerprint_evolution":
            return f"{result.get('count', 0)} laps of fingerprint history"
        if name == "find_similar_sessions":
            return f"{len(result.get('sessions') or [])} matching sessions"
        if name == "compare_sessions":
            d = result.get("best_lap_delta_ms")
            return f"best-lap delta {d:+.0f} ms" if d is not None else "comparison"
        if name == "personal_best_sector":
            ms = result.get("time_ms")
            return f"PB S{result.get('sector_num')}: {_fmt_lap_time(ms)}" if ms else "no record"
        if name == "get_session_history":
            return f"{len(result.get('sessions') or [])} prior sessions"
        if name == "list_layouts":
            return f"{len(result.get('layouts') or [])} saved layouts"
        if name == "apply_layout":
            return f"proposed layout '{result.get('name', '')}'"
        if name == "apply_math_channel":
            return f"proposed math channel '{result.get('name', '')}'"
    except Exception:
        return ""
    return ""


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
        if name == "get_coaching_points":
            return await tool_get_coaching_points(
                session_id,
                int(input["lap_num"]) if input.get("lap_num") is not None else None,
                int(input["sector_num"]) if input.get("sector_num") is not None else None,
            )
        if name == "get_fingerprint_evolution":
            return await tool_get_fingerprint_evolution(session_id)
        if name == "find_similar_sessions":
            return await tool_find_similar_sessions(
                session_id,
                input.get("venue"),
                input.get("vehicle"),
                input.get("driver"),
                int(input.get("limit", 20) or 20),
            )
        if name == "compare_sessions":
            return await tool_compare_sessions(
                session_id, str(input["other_session_id"])
            )
        if name == "personal_best_sector":
            return await tool_personal_best_sector(
                session_id,
                int(input["sector_num"]),
                input.get("venue"),
                input.get("driver"),
            )
        if name == "get_session_history":
            return await tool_get_session_history(
                session_id,
                input.get("driver"),
                input.get("venue"),
                int(input.get("limit", 20) or 20),
            )
        if name == "list_layouts":
            return await tool_list_layouts(session_id)
        if name == "apply_layout":
            return await tool_apply_layout(
                session_id, str(input["name"]), list(input["charts"])
            )
        if name == "apply_math_channel":
            return await tool_apply_math_channel(
                session_id, str(input["name"]), str(input["expression"])
            )
        return {"error": f"Unknown tool: {name}"}
    except KeyError as e:
        return {"error": f"Missing required input field: {e}"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
