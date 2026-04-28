"""Channel data endpoints — serves Arrow IPC binary."""

import base64
import math
import os

import numpy as np
import pyarrow as pa
import pyarrow.ipc as ipc
import pyarrow.compute as pc
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import Optional

from ..xrk_service import CACHE_DIR, get_resampled_lap_data
from ..database import get_db

router = APIRouter()


def _find_arrow_file(session_id: str, channel_name: str) -> Optional[str]:
    """Find the Arrow IPC file for a channel, handling name normalization."""
    cache_dir = os.path.join(CACHE_DIR, session_id)
    if not os.path.exists(cache_dir):
        return None

    safe_name = channel_name.replace("/", "_").replace(" ", "_")
    direct = os.path.join(cache_dir, f"{safe_name}.arrow")
    if os.path.exists(direct):
        return direct

    # Fuzzy match: try case-insensitive
    for fname in os.listdir(cache_dir):
        if fname.lower() == f"{safe_name.lower()}.arrow":
            return os.path.join(cache_dir, fname)

    return None


async def _get_lap_bounds(session_id: str, lap_num: int) -> Optional[tuple[int, int]]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT start_time_ms, end_time_ms FROM laps WHERE session_id = ? AND num = ?",
            (session_id, lap_num),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return int(row["start_time_ms"]), int(row["end_time_ms"])
    finally:
        await db.close()


async def _get_best_lap_bounds(session_id: str) -> Optional[tuple[int, int]]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT start_time_ms, end_time_ms FROM laps
               WHERE session_id = ? AND num > 0
               ORDER BY duration_ms ASC LIMIT 1""",
            (session_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return int(row["start_time_ms"]), int(row["end_time_ms"])
    finally:
        await db.close()


def _filter_table_by_bounds(table: pa.Table, start_ms: int, end_ms: int) -> pa.Table:
    """Filter an Arrow table to a specific time range."""
    tc_col = table.column("timecodes")
    mask = pa.compute.and_(
        pa.compute.greater_equal(tc_col, start_ms),
        pa.compute.less(tc_col, end_ms)
    )
    return table.filter(mask)


@router.get("/sessions/{session_id}/channels/{channel_name}/fft")
async def get_channel_fft(
    session_id: str,
    channel_name: str,
    lap: int = Query(..., description="Lap number"),
):
    """
    Compute FFT (frequency spectrum) for a channel in a specific lap.
    Returns frequency bins (Hz) and magnitudes.
    """
    table = get_resampled_lap_data(session_id, [channel_name], lap)
    if table is None or table.num_rows < 10:
        raise HTTPException(404, f"Not enough data for FFT on '{channel_name}'")

    if channel_name not in table.column_names:
        raise HTTPException(404, f"Channel '{channel_name}' not in resampled data")

    values = np.array(table.column(channel_name).to_pylist(), dtype=np.float64)
    tc = np.array(table.column("timecodes").to_pylist(), dtype=np.float64)

    dt_ms = np.median(np.diff(tc))
    if dt_ms <= 0:
        raise HTTPException(400, "Invalid timecodes for FFT")
    sample_rate = 1000.0 / dt_ms

    values = values - np.mean(values)
    window = np.hanning(len(values))
    values = values * window

    n = len(values)
    fft_result = np.fft.rfft(values)
    magnitudes = np.abs(fft_result) * 2.0 / n
    frequencies = np.fft.rfftfreq(n, d=1.0 / sample_rate)

    frequencies = frequencies[1:]
    magnitudes = magnitudes[1:]

    step = max(1, len(frequencies) // 500)

    return {
        "frequencies_hz": [round(f, 3) for f in frequencies[::step].tolist()],
        "magnitudes": [round(m, 6) for m in magnitudes[::step].tolist()],
        "sample_rate_hz": round(sample_rate, 1),
        "num_samples": n,
    }


@router.get("/sessions/{session_id}/channels/{channel_name:path}")
async def get_channel(
    session_id: str,
    channel_name: str,
    lap: Optional[int] = None,
    format: str = Query(default="arrow"),
):
    """Return channel data as Arrow IPC binary or JSON."""
    path = _find_arrow_file(session_id, channel_name)
    if not path:
        raise HTTPException(404, f"Channel '{channel_name}' not found for session {session_id}")

    if format == "arrow" and lap is None:
        # Fast path: serve the file directly
        return FileResponse(
            path,
            media_type="application/vnd.apache.arrow.file",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )

    # Need to read and potentially filter
    reader = ipc.open_file(path)
    table = reader.read_all()

    if lap is not None:
        lap_bounds = await _get_lap_bounds(session_id, lap)
        if lap_bounds is not None:
            table = _filter_table_by_bounds(table, *lap_bounds)

    if format == "json":
        # Convert to JSON-friendly format
        result = {}
        for col_name in table.column_names:
            arr = table.column(col_name).to_pylist()
            result[col_name] = arr
        return result

    # Return filtered Arrow IPC as binary
    sink = pa.BufferOutputStream()
    writer = ipc.new_file(sink, table.schema)
    writer.write_table(table)
    writer.close()
    return Response(
        content=sink.getvalue().to_pybytes(),
        media_type="application/vnd.apache.arrow.file",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


class BatchRequest(BaseModel):
    channels: list[str]
    lap: Optional[int] = None


@router.post("/sessions/{session_id}/channels/batch")
async def get_channels_batch(session_id: str, req: BatchRequest):
    """Return multiple channels in one request, base64-encoded Arrow IPC."""
    results = {}
    lap_bounds = await _get_lap_bounds(session_id, req.lap) if req.lap is not None else None

    for ch_name in req.channels:
        path = _find_arrow_file(session_id, ch_name)
        if not path:
            continue

        reader = ipc.open_file(path)
        table = reader.read_all()

        if lap_bounds is not None:
            table = _filter_table_by_bounds(table, *lap_bounds)

        sink = pa.BufferOutputStream()
        writer = ipc.new_file(sink, table.schema)
        writer.write_table(table)
        writer.close()

        results[ch_name] = {
            "arrow_b64": base64.b64encode(sink.getvalue().to_pybytes()).decode(),
            "rows": table.num_rows,
        }

    return results


@router.get("/sessions/{session_id}/resampled")
async def get_resampled_channels(
    session_id: str,
    channels: str = Query(..., description="Comma-separated channel names"),
    lap: int = Query(..., description="Lap number"),
    ref_channel: Optional[str] = Query(None, description="Reference channel for resampling timebase"),
):
    """
    Return multiple channels resampled to a common timebase for one lap.
    Uses libxrk's interpolation (linear for continuous, forward-fill for discrete).
    Returns dense Arrow IPC — no null gaps.
    """
    channel_list = [c.strip() for c in channels.split(",") if c.strip()]
    if not channel_list:
        raise HTTPException(400, "No channels specified")

    table = get_resampled_lap_data(session_id, channel_list, lap, ref_channel)
    if table is None or table.num_rows == 0:
        raise HTTPException(404, f"No data for channels {channel_list} in lap {lap}")

    sink = pa.BufferOutputStream()
    writer = ipc.new_file(sink, table.schema)
    writer.write_table(table)
    writer.close()

    return Response(
        content=sink.getvalue().to_pybytes(),
        media_type="application/vnd.apache.arrow.file",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@router.get("/sessions/{session_id}/distance")
async def get_distance_channel(
    session_id: str,
    lap: int = Query(..., description="Lap number"),
):
    """
    Compute cumulative distance from GPS lat/lon for a given lap.
    Returns JSON with timecodes (lap-relative ms) and distance_m arrays.
    """
    # Get GPS data resampled to common timebase
    gps_channels = ["GPS Latitude", "GPS Longitude"]
    table = get_resampled_lap_data(session_id, gps_channels, lap)
    if table is None or table.num_rows < 2:
        raise HTTPException(404, "No GPS data for this lap")

    tc = table.column("timecodes").to_pylist()
    lats = table.column("GPS Latitude").to_pylist()
    lons = table.column("GPS Longitude").to_pylist()

    # Haversine cumulative distance
    R = 6371000  # Earth radius in meters
    distances = [0.0]
    for i in range(1, len(lats)):
        lat1, lat2 = math.radians(lats[i - 1]), math.radians(lats[i])
        dlat = lat2 - lat1
        dlon = math.radians(lons[i] - lons[i - 1])
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        distances.append(distances[-1] + R * c)

    # Get lap start for normalization
    lap_bounds = await _get_lap_bounds(session_id, lap)
    offset = lap_bounds[0] if lap_bounds else 0

    return {
        "timecodes": [t - offset for t in tc],
        "distance_m": [round(d, 2) for d in distances],
    }


class StartFinishLine(BaseModel):
    lat1: float
    lon1: float
    lat2: float
    lon2: float


def _segments_cross(p1, p2, p3, p4):
    """True if segment p1-p2 crosses segment p3-p4 (in local meters)."""
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)


@router.post("/sessions/{session_id}/laps/recompute")
async def recompute_laps(session_id: str, line: StartFinishLine):
    """Recompute laps from GPS trajectory crossings of a user-defined start/finish line."""
    lat_path = _find_arrow_file(session_id, "GPS Latitude") or _find_arrow_file(session_id, "GPS_Latitude")
    lon_path = _find_arrow_file(session_id, "GPS Longitude") or _find_arrow_file(session_id, "GPS_Longitude")
    if not lat_path or not lon_path:
        raise HTTPException(404, "No GPS data for this session")

    lat_table = ipc.open_file(lat_path).read_all()
    lon_table = ipc.open_file(lon_path).read_all()
    lat = lat_table.column(1).to_pylist()
    lon = lon_table.column(1).to_pylist()
    tc = lat_table.column("timecodes").to_pylist()
    n = min(len(lat), len(lon), len(tc))
    if n < 2:
        raise HTTPException(400, "Not enough GPS samples")

    # Project to local meters around the line midpoint
    mlat = (line.lat1 + line.lat2) / 2
    mpd_lat = 111320.0
    mpd_lon = 111320.0 * max(0.01, math.cos(math.radians(mlat)))

    def to_xy(la, lo):
        return ((la - mlat) * mpd_lat, (lo - line.lon1) * mpd_lon)

    line_a = to_xy(line.lat1, line.lon1)
    line_b = to_xy(line.lat2, line.lon2)

    # Find every sample pair where trajectory crosses the line
    crossings: list[int] = []
    prev = to_xy(lat[0], lon[0])
    for i in range(1, n):
        cur = to_xy(lat[i], lon[i])
        if _segments_cross(prev, cur, line_a, line_b):
            crossings.append(tc[i])
        prev = cur

    if len(crossings) < 2:
        raise HTTPException(400, f"Only {len(crossings)} crossings found — check start/finish line placement")

    # Build laps: lap 0 = from start of data to first crossing; lap N = between crossings
    laps: list[dict] = []
    laps.append({
        "num": 0,
        "start_time_ms": tc[0],
        "end_time_ms": crossings[0],
        "duration_ms": crossings[0] - tc[0],
    })
    for i in range(len(crossings) - 1):
        laps.append({
            "num": i + 1,
            "start_time_ms": crossings[i],
            "end_time_ms": crossings[i + 1],
            "duration_ms": crossings[i + 1] - crossings[i],
        })

    # Persist
    db = await get_db()
    try:
        await db.execute("DELETE FROM laps WHERE session_id = ?", (session_id,))
        await db.executemany(
            "INSERT INTO laps (session_id, num, start_time_ms, end_time_ms, duration_ms) VALUES (?,?,?,?,?)",
            [(session_id, l["num"], l["start_time_ms"], l["end_time_ms"], l["duration_ms"]) for l in laps],
        )
        racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
        best = min((l["duration_ms"] for l in racing), default=0)
        await db.execute(
            "UPDATE sessions SET lap_count = ?, best_lap_time_ms = ? WHERE id = ?",
            (len(laps), best, session_id),
        )
        await db.commit()
    finally:
        await db.close()

    return {"laps": laps, "crossings": len(crossings), "best_lap_time_ms": best}


@router.get("/sessions/{session_id}/laps/diagnostics")
async def laps_diagnostics(session_id: str):
    """
    Report the difference between libxrk-reported lap start times and the
    first telemetry sample timecode per lap. Useful for spotting lap-start
    misalignment — anything >50ms is flagged.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT num, start_time_ms FROM laps WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        lap_rows = [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()

    diags = []
    for lap in lap_rows:
        tbl = get_resampled_lap_data(session_id, ["GPS Latitude"], lap["num"])
        first_tc = None
        if tbl is not None:
            tc = tbl.column("timecodes").to_pylist()
            if tc:
                first_tc = tc[0]
        diff = None
        if first_tc is not None:
            diff = int(first_tc - lap["start_time_ms"])
        diags.append(
            {
                "num": lap["num"],
                "start_time_ms_libxrk": lap["start_time_ms"],
                "first_sample_timecode_ms": first_tc,
                "diff_ms": diff,
                "flagged": diff is not None and abs(diff) > 50,
            }
        )
    return {"laps": diags}


@router.get("/sessions/{session_id}/delta-t")
async def get_delta_t(
    session_id: str,
    ref_lap: int = Query(..., description="Reference lap number"),
    compare_lap: int = Query(..., description="Comparison lap number"),
):
    """
    Compute rolling time delta between two laps in the distance domain.
    Positive delta = compare lap is slower (ref ahead).
    Returns distance_m and delta_seconds arrays.
    """
    gps_channels = ["GPS Latitude", "GPS Longitude"]

    ref_table = get_resampled_lap_data(session_id, gps_channels, ref_lap)
    cmp_table = get_resampled_lap_data(session_id, gps_channels, compare_lap)

    if ref_table is None or cmp_table is None:
        raise HTTPException(404, "GPS data not available for one or both laps")

    def _compute_distance_time(table, lap_num):
        """Return (distance_m[], time_s[]) arrays for a lap."""
        tc = table.column("timecodes").to_pylist()
        lats = table.column("GPS Latitude").to_pylist()
        lons = table.column("GPS Longitude").to_pylist()

        R = 6371000
        dist = [0.0]
        for i in range(1, len(lats)):
            lat1, lat2 = math.radians(lats[i - 1]), math.radians(lats[i])
            dlat = lat2 - lat1
            dlon = math.radians(lons[i] - lons[i - 1])
            a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            dist.append(dist[-1] + R * c)

        time_s = [(t - tc[0]) / 1000.0 for t in tc]
        return dist, time_s

    ref_dist, ref_time = _compute_distance_time(ref_table, ref_lap)
    cmp_dist, cmp_time = _compute_distance_time(cmp_table, compare_lap)

    # Interpolate: for each distance on the reference track,
    # find the time on the compare lap at that distance
    cmp_dist_np = np.array(cmp_dist)
    cmp_time_np = np.array(cmp_time)
    ref_dist_np = np.array(ref_dist)
    ref_time_np = np.array(ref_time)

    # Clamp to overlapping distance range
    max_dist = min(ref_dist_np[-1], cmp_dist_np[-1])
    mask = ref_dist_np <= max_dist
    out_dist = ref_dist_np[mask]
    out_ref_time = ref_time_np[mask]

    # Interpolate compare time at reference distances
    out_cmp_time = np.interp(out_dist, cmp_dist_np, cmp_time_np)

    # Delta = compare_time - ref_time (positive = compare is slower)
    delta = out_cmp_time - out_ref_time

    return {
        "distance_m": [round(d, 2) for d in out_dist.tolist()],
        "delta_seconds": [round(d, 4) for d in delta.tolist()],
    }


@router.get("/sessions/{session_id}/predictive")
async def get_predictive(
    session_id: str,
    ref_lap: int = Query(..., description="Reference (fast) lap"),
    current_lap: int = Query(..., description="Current lap to compare"),
):
    """
    Predictive delta: how far ahead/behind the current lap is vs ref at each
    point on the track. Returns {distance: [...], delta_ms: [...]}.
    Negative = gaining on ref; positive = losing time.
    """
    gps_channels = ["GPS Latitude", "GPS Longitude"]
    ref_table = get_resampled_lap_data(session_id, gps_channels, ref_lap)
    cur_table = get_resampled_lap_data(session_id, gps_channels, current_lap)
    if ref_table is None or cur_table is None:
        raise HTTPException(404, "GPS data not available for one or both laps")

    def _compute_distance_time(table):
        tc = table.column("timecodes").to_pylist()
        lats = table.column("GPS Latitude").to_pylist()
        lons = table.column("GPS Longitude").to_pylist()
        R = 6371000
        dist = [0.0]
        for i in range(1, len(lats)):
            lat1, lat2 = math.radians(lats[i - 1]), math.radians(lats[i])
            dlat = lat2 - lat1
            dlon = math.radians(lons[i] - lons[i - 1])
            a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            dist.append(dist[-1] + R * c)
        time_s = [(t - tc[0]) / 1000.0 for t in tc]
        return dist, time_s

    ref_dist, ref_time = _compute_distance_time(ref_table)
    cur_dist, cur_time = _compute_distance_time(cur_table)

    cur_dist_np = np.array(cur_dist)
    cur_time_np = np.array(cur_time)
    ref_dist_np = np.array(ref_dist)
    ref_time_np = np.array(ref_time)

    max_dist = min(ref_dist_np[-1] if len(ref_dist_np) else 0.0,
                   cur_dist_np[-1] if len(cur_dist_np) else 0.0)
    mask = ref_dist_np <= max_dist
    out_dist = ref_dist_np[mask]
    out_ref_time = ref_time_np[mask]
    out_cur_time = np.interp(out_dist, cur_dist_np, cur_time_np)

    # delta_ms = current elapsed - ref elapsed (positive = losing)
    delta_ms = (out_cur_time - out_ref_time) * 1000.0

    return {
        "distance": [round(float(d), 2) for d in out_dist.tolist()],
        "delta_ms": [round(float(d), 1) for d in delta_ms.tolist()],
    }


@router.get("/sessions/{session_id}/stats")
async def get_channel_stats(
    session_id: str,
    channels: str = Query(..., description="Comma-separated channel names"),
    lap: int = Query(..., description="Lap number"),
):
    """
    Compute min/max/avg/stdev/percentiles for channels in a lap.
    Returns JSON keyed by channel name.
    """
    channel_list = [c.strip() for c in channels.split(",") if c.strip()]
    if not channel_list:
        raise HTTPException(400, "No channels specified")

    table = get_resampled_lap_data(session_id, channel_list, lap)
    if table is None or table.num_rows == 0:
        raise HTTPException(404, "No data found")

    results = {}
    for ch_name in table.column_names:
        if ch_name == "timecodes":
            continue
        col = table.column(ch_name)
        arr = col.to_pylist()
        arr_clean = [v for v in arr if v is not None and math.isfinite(v)]
        if not arr_clean:
            continue

        np_arr = np.array(arr_clean, dtype=np.float64)
        results[ch_name] = {
            "min": round(float(np_arr.min()), 3),
            "max": round(float(np_arr.max()), 3),
            "avg": round(float(np_arr.mean()), 3),
            "stdev": round(float(np_arr.std()), 3),
            "p5": round(float(np.percentile(np_arr, 5)), 3),
            "p50": round(float(np.percentile(np_arr, 50)), 3),
            "p95": round(float(np.percentile(np_arr, 95)), 3),
            "count": len(arr_clean),
        }

    return results


@router.get("/sessions/{session_id}/track-overlay")
async def get_track_overlay(
    session_id: str,
    channel: str = Query(..., description="Channel to colorize track by"),
    lap: Optional[int] = Query(None, description="Lap number (defaults to best lap)"),
):
    """
    Return GPS coordinates with a specified channel interpolated to GPS sample rate.
    For coloring the track map by any channel value.
    """
    lap_num = lap
    if lap_num is None:
        bounds = await _get_best_lap_bounds(session_id)
        if bounds is None:
            raise HTTPException(404, "No lap data")
        # Find best lap number
        db = await get_db()
        try:
            cursor = await db.execute(
                "SELECT num FROM laps WHERE session_id = ? AND num > 0 ORDER BY duration_ms ASC LIMIT 1",
                (session_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                raise HTTPException(404, "No laps found")
            lap_num = int(row["num"])
        finally:
            await db.close()

    gps_channels = ["GPS Latitude", "GPS Longitude", channel]
    # Deduplicate
    gps_channels = list(dict.fromkeys(gps_channels))

    table = get_resampled_lap_data(session_id, gps_channels, lap_num, "GPS Latitude")
    if table is None or table.num_rows == 0:
        raise HTTPException(404, "No GPS or channel data")

    lat = table.column("GPS Latitude").to_pylist()
    lon = table.column("GPS Longitude").to_pylist()

    ch_values = None
    if channel in table.column_names:
        ch_values = table.column(channel).to_pylist()

    # Downsample for performance
    step = max(1, len(lat) // 500)

    return {
        "lat": lat[::step],
        "lon": lon[::step],
        "values": ch_values[::step] if ch_values else None,
        "channel": channel,
        "point_count": len(lat[::step]),
    }


@router.get("/sessions/{session_id}/track")
async def get_track(session_id: str, lap: int | None = None):
    """Return GPS coordinates for the best lap (or specified lap) for track map."""
    # Find GPS channels
    lat_path = _find_arrow_file(session_id, "GPS Latitude") or _find_arrow_file(session_id, "GPS_Latitude")
    lon_path = _find_arrow_file(session_id, "GPS Longitude") or _find_arrow_file(session_id, "GPS_Longitude")
    speed_path = _find_arrow_file(session_id, "GPS Speed") or _find_arrow_file(session_id, "GPS_Speed")

    if not lat_path or not lon_path:
        raise HTTPException(404, "No GPS data found for this session")

    lat_table = ipc.open_file(lat_path).read_all()
    lon_table = ipc.open_file(lon_path).read_all()

    if lap is not None:
        best_lap_bounds = await _get_lap_bounds(session_id, lap)
    else:
        best_lap_bounds = await _get_best_lap_bounds(session_id)

    if best_lap_bounds is not None:
        start_ms, end_ms = best_lap_bounds
        lat_table = _filter_table_by_bounds(lat_table, start_ms, end_ms)
        lon_table = _filter_table_by_bounds(lon_table, start_ms, end_ms)

    lat_col = lat_table.column(1).to_pylist()  # second column is the value
    lon_col = lon_table.column(1).to_pylist()

    # Downsample for track outline (500 points is plenty)
    step = max(1, len(lat_col) // 500)
    lat_sampled = lat_col[::step]
    lon_sampled = lon_col[::step]

    # Speed data if available
    speed_data = None
    if speed_path:
        speed_table = ipc.open_file(speed_path).read_all()
        if best_lap_bounds is not None:
            speed_table = _filter_table_by_bounds(speed_table, *best_lap_bounds)
        speed_col = speed_table.column(1).to_pylist()
        speed_data = speed_col[::step]

    # Include timecodes for cursor sync (lap-relative in ms)
    tc_sampled = None
    if best_lap_bounds is not None:
        tc_col = lat_table.column("timecodes").to_pylist()
        tc_sampled = [(t - best_lap_bounds[0]) for t in tc_col[::step]]

    return {
        "lat": lat_sampled,
        "lon": lon_sampled,
        "speed": speed_data,
        "timecodes": tc_sampled,
        "point_count": len(lat_sampled),
    }


# ---------------------------------------------------------------------------
# Channels Report (Phase 14.2) — per-lap aggregate statistics for any number
# of channels, returned in one shot so the UI renders a pivoted table.
# ---------------------------------------------------------------------------


_SUPPORTED_STATS = {"min", "max", "avg", "p50", "p90", "p99", "std", "count"}


@router.get("/sessions/{session_id}/channels-report")
async def channels_report(
    session_id: str,
    channels: str = Query(..., description="Comma-separated channel names"),
    stats: str = Query(
        "min,max,avg,p90",
        description="Comma-separated subset of: min,max,avg,p50,p90,p99,std,count",
    ),
    include_pit_laps: bool = Query(False),
    corners_only: bool = Query(
        False,
        description="When true, restrict aggregation to samples whose timestamp "
        "falls inside a detected corner range for that lap.",
    ),
):
    """Return per-lap aggregate stats for a set of channels.

    Response shape (names are literals, values are numbers or null):
        {
          "channels": ["RPM","GPS Speed", ...],
          "stats": ["min","max","avg","p90"],
          "laps": [
            {"num":1,"duration_ms":45200,"is_pit_lap":false,
             "cells":{"RPM":{"min":8000,"max":14200,"avg":...,"p90":...}, ...}},
            ...
          ],
          "session_wide":{"RPM":{"min":...,"max":...,"avg":...,"p90":...}, ...}
        }
    """
    ch_list = [c.strip() for c in channels.split(",") if c.strip()]
    if not ch_list:
        raise HTTPException(400, "channels query param cannot be empty")

    wanted_stats = [s.strip() for s in stats.split(",") if s.strip()]
    bad = [s for s in wanted_stats if s not in _SUPPORTED_STATS]
    if bad:
        raise HTTPException(
            400,
            f"unsupported stat(s): {bad}. supported: {sorted(_SUPPORTED_STATS)}",
        )

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT num, duration_ms, is_pit_lap FROM laps "
            "WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        lap_rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    if not lap_rows:
        raise HTTPException(404, f"No laps for session {session_id}")

    # Phase 26 follow-up: when corners_only is set, fetch per-lap corner time
    # ranges so we can mask each lap's resampled table down to in-corner
    # samples before computing stats.
    corner_ranges: dict[int, list[tuple[int, int]]] = {}
    if corners_only:
        from ..corners import corner_time_ranges_per_lap
        corner_ranges = await corner_time_ranges_per_lap(session_id)

    def _compute(values: np.ndarray) -> dict[str, float | None]:
        if values.size == 0:
            return {s: None for s in wanted_stats}
        out: dict[str, float | None] = {}
        for s in wanted_stats:
            if s == "min":
                out[s] = float(np.min(values))
            elif s == "max":
                out[s] = float(np.max(values))
            elif s == "avg":
                out[s] = float(np.mean(values))
            elif s == "p50":
                out[s] = float(np.percentile(values, 50))
            elif s == "p90":
                out[s] = float(np.percentile(values, 90))
            elif s == "p99":
                out[s] = float(np.percentile(values, 99))
            elif s == "std":
                out[s] = float(np.std(values))
            elif s == "count":
                out[s] = int(values.size)
        return out

    # Collect all-session values per channel for session_wide rollup.
    session_wide_bins: dict[str, list[np.ndarray]] = {c: [] for c in ch_list}
    laps_out: list[dict] = []

    for lap in lap_rows:
        if lap["num"] <= 0 or lap["duration_ms"] <= 0:
            continue
        if lap.get("is_pit_lap") and not include_pit_laps:
            # Still emit the row so the UI can render it greyed, but skip
            # stats computation to save time.
            laps_out.append({
                "num": lap["num"],
                "duration_ms": lap["duration_ms"],
                "is_pit_lap": True,
                "cells": {c: {s: None for s in wanted_stats} for c in ch_list},
            })
            continue

        table = get_resampled_lap_data(session_id, ch_list, lap["num"])
        cells: dict[str, dict[str, float | None]] = {}
        if table is None:
            cells = {c: {s: None for s in wanted_stats} for c in ch_list}
        else:
            # Build a sample-level mask for corners_only filtering.
            # Tables are time-keyed via the "timecodes" column (ms since
            # session start). We build a boolean mask spanning the lap and
            # set True only for samples falling inside any corner range.
            corner_mask: Optional[np.ndarray] = None
            if corners_only:
                ranges = corner_ranges.get(int(lap["num"]), [])
                try:
                    tc = np.asarray(
                        table.column("timecodes").to_pylist(), dtype=np.float64
                    )
                except Exception:
                    tc = None
                if tc is not None and tc.size and ranges:
                    m = np.zeros(tc.size, dtype=bool)
                    for s_ts, e_ts in ranges:
                        m |= (tc >= float(s_ts)) & (tc <= float(e_ts))
                    corner_mask = m
                else:
                    # No corner data → emit empty cells rather than the
                    # whole lap (clearer signal in the UI).
                    corner_mask = np.zeros(
                        tc.size if tc is not None else 0, dtype=bool
                    )
            for c in ch_list:
                try:
                    col = np.asarray(table.column(c).to_pylist(), dtype=np.float64)
                    if corner_mask is not None and corner_mask.size == col.size:
                        col = col[corner_mask]
                    col = col[np.isfinite(col)]
                except Exception:
                    col = np.asarray([], dtype=np.float64)
                cells[c] = _compute(col)
                if col.size:
                    session_wide_bins[c].append(col)

        laps_out.append({
            "num": lap["num"],
            "duration_ms": lap["duration_ms"],
            "is_pit_lap": bool(lap.get("is_pit_lap")),
            "cells": cells,
        })

    session_wide: dict[str, dict[str, float | None]] = {}
    for c, chunks in session_wide_bins.items():
        if chunks:
            merged = np.concatenate(chunks)
            session_wide[c] = _compute(merged)
        else:
            session_wide[c] = {s: None for s in wanted_stats}

    return {
        "channels": ch_list,
        "stats": wanted_stats,
        "laps": laps_out,
        "session_wide": session_wide,
    }
