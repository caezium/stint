"""Corner detection (Phase 26.1).

Walks the session's lateral-g channel (or derives one from GPS curvature when
no LatG channel is present), groups contiguous high-|LatG| regions into
"corners", and writes one row per corner into the `corners` table with
entry/exit/min speed and peak g. The populated rows feed:

  - a map overlay showing the corner arcs coloured by peak g
  - an "in-corner only" filter in the channels report
  - the fuel-usage estimator's "time-in-corner" stat

The threshold defaults are karting-tuned: `|LatG| > 0.3` opens a corner,
`|LatG| < 0.15` for a minimum of 300 ms closes it, and runs shorter than 800 ms
are dropped. Falls back silently (logging a short notice) when the session
has no usable GPS or acceleration data.
"""

from __future__ import annotations

import math
import os
import sqlite3
from typing import Optional

import numpy as np

from .database import get_db


DATA_DIR = os.environ.get("DATA_DIR", "/app/data")


def _try_read_channel(session_id: str, names: list[str]) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Read the first channel from `names` that exists in the arrow cache.
    Returns (timecodes_ms, values) or None when none of the names resolve."""
    from .routers.channels import _find_arrow_file
    import pyarrow.ipc as ipc

    for name in names:
        p = _find_arrow_file(session_id, name)
        if not p:
            continue
        try:
            table = ipc.open_file(p).read_all()
            ts = np.asarray(table.column(0).to_pylist(), dtype=np.float64)
            vs = np.asarray(table.column(1).to_pylist(), dtype=np.float64)
            return ts, vs
        except Exception:
            continue
    return None


def _derive_lat_g_from_gps(
    lat: np.ndarray, lon: np.ndarray, ts_ms: np.ndarray, speed_mps: np.ndarray
) -> np.ndarray:
    """Fallback LatG from GPS — yaw-rate approach rather than discrete curvature
    because per-sample curvature is extremely noisy. Computes the heading
    change over a ~500ms window, then latG = v * ω / g0.
    """
    n = min(len(lat), len(lon), len(ts_ms), len(speed_mps))
    if n < 5:
        return np.zeros(n)
    mlat = float(np.nanmean(lat[:n]))
    mpd_lat = 111320.0
    mpd_lon = 111320.0 * max(0.01, math.cos(math.radians(mlat)))
    xs = (lat[:n] - lat[0]) * mpd_lat
    ys = (lon[:n] - lon[0]) * mpd_lon
    # Compute instantaneous heading (radians) from forward-difference tangent.
    heading = np.zeros(n)
    for i in range(1, n - 1):
        dx = xs[i + 1] - xs[i - 1]
        dy = ys[i + 1] - ys[i - 1]
        heading[i] = math.atan2(dy, dx)
    heading[0] = heading[1]
    heading[-1] = heading[-2]
    # Unwrap to avoid jumps at ±π.
    heading = np.unwrap(heading)
    # Yaw rate ω = dψ/dt with ~500ms centred window.
    out = np.zeros(n)
    window = 12  # 12 * ~40ms ≈ 480ms at the 25 Hz resample grid used upstream
    for i in range(window, n - window):
        dt_s = (ts_ms[i + window] - ts_ms[i - window]) / 1000.0
        if dt_s <= 0:
            continue
        omega = (heading[i + window] - heading[i - window]) / dt_s
        out[i] = (speed_mps[i] * omega) / 9.81
    return out


def _lap_bounds(session_id: str) -> dict[int, tuple[int, int]]:
    db_path = os.path.join(DATA_DIR, "telemetry.db")
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.execute(
            "SELECT num, start_time_ms, end_time_ms FROM laps WHERE session_id=?",
            (session_id,),
        )
        rows = cur.fetchall()
        conn.close()
    except Exception:
        return {}
    return {int(r[0]): (int(r[1]), int(r[2])) for r in rows}


def _cumulative_distance(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    n = len(lat)
    if n == 0:
        return np.zeros(0)
    dist = np.zeros(n)
    mlat = float(np.nanmean(lat))
    mpd_lat = 111320.0
    mpd_lon = 111320.0 * max(0.01, math.cos(math.radians(mlat)))
    for i in range(1, n):
        dx = (lon[i] - lon[i - 1]) * mpd_lon
        dy = (lat[i] - lat[i - 1]) * mpd_lat
        dist[i] = dist[i - 1] + math.hypot(dx, dy)
    return dist


async def detect_corners(session_id: str) -> int:
    """Detect corners for the session and write them to the `corners` table.

    Corners are extracted from the session's **representative lap** (fastest
    non-pit lap) so we get one canonical set of track corners instead of
    duplicating the same corner per lap. Existing rows are replaced.
    Returns the number of rows written.
    """
    # Pick representative lap = fastest non-pit lap; fall back to fastest.
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, is_pit_lap, duration_ms "
            "FROM laps WHERE session_id = ? AND num > 0 AND duration_ms > 0 "
            "ORDER BY is_pit_lap ASC, duration_ms ASC LIMIT 1",
            (session_id,),
        )
        rep_lap = await cur.fetchone()
    finally:
        await db.close()
    if not rep_lap:
        return 0
    lap_start_ms = int(rep_lap["start_time_ms"])
    lap_end_ms = int(rep_lap["end_time_ms"])

    # Resolve LatG — prefer a real channel, else derive from GPS + speed.
    lat_g_pair = _try_read_channel(
        session_id,
        [
            "GPS LatAcc", "GPS_LatAcc",
            "GPS LateralAcc", "GPS_LateralAcc",
            "LateralAcc", "Lateral Accel", "Lateral Acc",
            "LatG", "Lat G", "Lat Acc", "Accel Lat",
        ],
    )

    lat_pair = _try_read_channel(session_id, ["GPS Latitude", "GPS_Latitude"])
    lon_pair = _try_read_channel(session_id, ["GPS Longitude", "GPS_Longitude"])
    spd_pair = _try_read_channel(session_id, ["GPS Speed", "Speed"])

    if lat_pair is None or lon_pair is None or spd_pair is None:
        return 0
    lat_ts, lat_vals = lat_pair
    lon_ts, lon_vals = lon_pair
    spd_ts, spd_vals = spd_pair

    # Common timebase — clipped to the representative lap so each corner
    # corresponds to a single pass of the track.
    t_min = max(float(lat_ts[0]), float(lon_ts[0]), float(spd_ts[0]), float(lap_start_ms))
    t_max = min(float(lat_ts[-1]), float(lon_ts[-1]), float(spd_ts[-1]), float(lap_end_ms))
    if t_max <= t_min + 1000:
        return 0
    step_ms = 40.0  # 25 Hz
    grid = np.arange(t_min, t_max, step_ms)
    lat_r = np.interp(grid, lat_ts, lat_vals)
    lon_r = np.interp(grid, lon_ts, lon_vals)
    # GPS Speed is typically km/h; convert to m/s if values look > 50 (karts rarely do m/s > 35).
    spd_raw = np.interp(grid, spd_ts, spd_vals)
    # Heuristic: if max reading is > 40 we assume km/h.
    spd_mps = spd_raw / 3.6 if float(np.nanmax(spd_raw)) > 40.0 else spd_raw

    if lat_g_pair is not None:
        ltg = np.interp(grid, lat_g_pair[0], lat_g_pair[1])
        # Unit detection: max is unreliable (noise spikes exceed what a kart
        # actually pulls), so gate on p99 instead. Real LatG in g stays under
        # ~2.5 even in aggressive sessions; m/s² LatG routinely exceeds ~5.
        p99_abs = float(np.nanpercentile(np.abs(ltg), 99))
        if p99_abs > 5.0:
            ltg = ltg / 9.81
    else:
        ltg = _derive_lat_g_from_gps(lat_r, lon_r, grid, spd_mps)

    # Smooth the LatG trace over ~250ms to remove IMU noise spikes that
    # would otherwise carve one long corner into many tiny fragments.
    if ltg.size >= 7:
        w = 7  # 7 * 40ms = 280ms
        pad = w // 2
        padded = np.pad(ltg, (pad, w - pad - 1), mode="edge")
        ltg = np.convolve(padded, np.ones(w) / w, mode="valid")

    # Simple hysteresis detector: open at |g| > OPEN, close when |g| < CLOSE
    # for at least MIN_GAP_MS.
    OPEN_G = 0.30
    CLOSE_G = 0.15
    MIN_DURATION_MS = 800.0
    MIN_GAP_MS = 300.0

    abs_g = np.abs(ltg)
    above_open = abs_g > OPEN_G
    below_close = abs_g < CLOSE_G

    corners: list[dict] = []
    i = 0
    n = len(grid)
    while i < n:
        if not above_open[i]:
            i += 1
            continue
        # Corner start: find the first "above_open" sample.
        start = i
        # Extend while not in a sustained below_close segment.
        j = i + 1
        gap_start: Optional[int] = None
        end = start
        while j < n:
            if below_close[j]:
                if gap_start is None:
                    gap_start = j
                if (grid[j] - grid[gap_start]) >= MIN_GAP_MS:
                    end = gap_start
                    break
            else:
                gap_start = None
                end = j
            j += 1
        else:
            end = n - 1
        duration_ms = grid[end] - grid[start]
        if duration_ms >= MIN_DURATION_MS:
            seg = slice(start, end + 1)
            seg_lats = lat_r[seg]
            seg_lons = lon_r[seg]
            seg_speed = spd_mps[seg]
            seg_g = ltg[seg]
            peak_idx = int(np.argmax(np.abs(seg_g)))
            peak_g = float(seg_g[peak_idx])
            # Entry / exit / min speeds in km/h for the user-facing display.
            entry = float(seg_speed[0] * 3.6)
            exit_ = float(seg_speed[-1] * 3.6)
            min_v = float(np.min(seg_speed) * 3.6)
            # Direction from peak sign (positive = right-hand in most
            # loggers but loggers differ — store as 'left'/'right' agnostic)
            direction = "right" if peak_g >= 0 else "left"
            corners.append({
                "start_ts": float(grid[start]),
                "end_ts": float(grid[end]),
                "start_lat": float(seg_lats[0]),
                "start_lon": float(seg_lons[0]),
                "end_lat": float(seg_lats[-1]),
                "end_lon": float(seg_lons[-1]),
                "peak_lat_g": peak_g,
                "entry_speed": entry,
                "exit_speed": exit_,
                "min_speed": min_v,
                "direction": direction,
            })
        i = end + 1

    if not corners:
        return 0

    # Distance reference for ordering + display. Assumes a single lap's GPS
    # trace — sessions with N laps will repeat distance segments; that's ok
    # because the UI filters corners by lap_num via timestamp bounds.
    cum = _cumulative_distance(lat_r, lon_r)
    grid_list = grid.tolist()

    def dist_at(ts: float) -> float:
        idx = int(np.searchsorted(grid_list, ts))
        idx = max(0, min(len(cum) - 1, idx))
        return float(cum[idx])

    # Persist
    db = await get_db()
    try:
        await db.execute("DELETE FROM corners WHERE session_id = ?", (session_id,))
        for i, c in enumerate(corners, start=1):
            await db.execute(
                """INSERT INTO corners
                   (session_id, corner_num, start_distance_m, end_distance_m,
                    peak_lat_g, entry_speed, exit_speed, min_speed, direction)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    i,
                    dist_at(c["start_ts"]),
                    dist_at(c["end_ts"]),
                    c["peak_lat_g"],
                    c["entry_speed"],
                    c["exit_speed"],
                    c["min_speed"],
                    c["direction"],
                ),
            )
        await db.commit()
    finally:
        await db.close()

    return len(corners)


async def list_corners(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT corner_num, start_distance_m, end_distance_m, peak_lat_g, "
            "entry_speed, exit_speed, min_speed, direction "
            "FROM corners WHERE session_id = ? ORDER BY corner_num",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
