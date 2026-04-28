"""Cross-session comparison endpoints."""

import math

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from ..xrk_service import get_resampled_lap_data

router = APIRouter()


class LapRef(BaseModel):
    session_id: str
    lap: int


class CompareDeltaRequest(BaseModel):
    ref: LapRef
    compare: LapRef


class LapDeltaPointsRequest(BaseModel):
    """Compare lap request for the track-map delta-colour overlay."""
    ref: LapRef


def _lap_distance_time(session_id: str, lap: int):
    """Return (distance_m, time_s, lats, lons) for a lap's GPS track."""
    table = get_resampled_lap_data(session_id, ["GPS Latitude", "GPS Longitude"], lap)
    if table is None:
        raise HTTPException(404, f"GPS data not available for session {session_id} lap {lap}")

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
    return dist, time_s, lats, lons


@router.post("/compare/delta-t")
async def cross_session_delta_t(req: CompareDeltaRequest):
    """
    Rolling time delta between two laps (possibly from different sessions)
    in the distance domain. Positive delta = compare lap is slower.
    """
    ref_dist, ref_time, _, _ = _lap_distance_time(req.ref.session_id, req.ref.lap)
    cmp_dist, cmp_time, _, _ = _lap_distance_time(req.compare.session_id, req.compare.lap)

    ref_dist_np = np.array(ref_dist)
    ref_time_np = np.array(ref_time)
    cmp_dist_np = np.array(cmp_dist)
    cmp_time_np = np.array(cmp_time)

    max_dist = float(min(ref_dist_np[-1], cmp_dist_np[-1]))
    mask = ref_dist_np <= max_dist
    out_dist = ref_dist_np[mask]
    out_ref_time = ref_time_np[mask]
    out_cmp_time = np.interp(out_dist, cmp_dist_np, cmp_time_np)
    delta = out_cmp_time - out_ref_time

    return {
        "distance_m": [round(d, 2) for d in out_dist.tolist()],
        "delta_seconds": [round(d, 4) for d in delta.tolist()],
    }


def _project_lap_to_corner_distance_bands(
    session_id: str, lap: int, corner_distance_bands: list[tuple[int, str, float, float]]
) -> dict[int, dict]:
    """Per-corner stats for a single (session, lap) given corner distance
    bands defined in the rep-lap distance domain. Returns
    { corner_num: { entry_speed, min_speed, exit_speed, corner_ms } }."""
    table = get_resampled_lap_data(
        session_id, ["GPS Latitude", "GPS Longitude", "GPS Speed"], lap
    )
    if table is None:
        return {}
    tc = np.asarray(table.column("timecodes").to_pylist(), dtype=np.float64)
    lats = np.asarray(table.column("GPS Latitude").to_pylist(), dtype=np.float64)
    lons = np.asarray(table.column("GPS Longitude").to_pylist(), dtype=np.float64)
    spd = np.asarray(table.column("GPS Speed").to_pylist(), dtype=np.float64)
    if tc.size < 5:
        return {}
    # GPS speed is usually km/h; treat values >40 as km/h.
    spd_mps = spd / 3.6 if float(np.nanmax(spd)) > 40.0 else spd
    # Cumulative distance per lap.
    R = 6371000.0
    dist = np.zeros(lats.size)
    for i in range(1, lats.size):
        lat1, lat2 = math.radians(lats[i - 1]), math.radians(lats[i])
        dlat = lat2 - lat1
        dlon = math.radians(lons[i] - lons[i - 1])
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        dist[i] = dist[i - 1] + R * c
    out: dict[int, dict] = {}
    for corner_num, _label, start_d, end_d in corner_distance_bands:
        mask = (dist >= start_d) & (dist <= end_d)
        if not mask.any():
            continue
        ts_in = tc[mask]
        spd_in = spd_mps[mask]
        if ts_in.size < 2:
            continue
        out[int(corner_num)] = {
            "entry_speed": float(spd_in[0] * 3.6),
            "exit_speed": float(spd_in[-1] * 3.6),
            "min_speed": float(spd_in.min() * 3.6),
            "corner_ms": int(ts_in[-1] - ts_in[0]),
        }
    return out


@router.post("/compare/per-corner")
async def compare_per_corner(req: CompareDeltaRequest):
    """Corner-by-corner comparison between two laps. Uses corners detected
    on the *ref* session (falling back to compare session if ref has no
    corners) and projects each lap's GPS trace onto those distance bands.

    Returns one row per corner with each lap's entry / min / exit / time-
    in-corner plus the lap's per-corner delta in ms (compare − ref).
    Powers the "Where am I losing time?" panel on the compare page.
    """
    from ..corners import list_corners as _list_corners
    # Try ref first, fall back to compare.
    ref_corners = await _list_corners(req.ref.session_id)
    cmp_corners = await _list_corners(req.compare.session_id)
    used_session: Optional[str] = None
    chosen = None
    if ref_corners:
        chosen = ref_corners
        used_session = req.ref.session_id
    elif cmp_corners:
        chosen = cmp_corners
        used_session = req.compare.session_id
    if not chosen:
        return {"corners": [], "ref_session": None, "compare_session": None, "source_session": None}

    bands = [
        (
            int(c["corner_num"]),
            (c.get("label") or ""),
            float(c["start_distance_m"]),
            float(c["end_distance_m"]),
        )
        for c in chosen
    ]
    ref_proj = _project_lap_to_corner_distance_bands(
        req.ref.session_id, req.ref.lap, bands
    )
    cmp_proj = _project_lap_to_corner_distance_bands(
        req.compare.session_id, req.compare.lap, bands
    )
    rows = []
    for c in chosen:
        n = int(c["corner_num"])
        r = ref_proj.get(n)
        x = cmp_proj.get(n)
        ref_ms = r["corner_ms"] if r else None
        cmp_ms = x["corner_ms"] if x else None
        delta_ms = (cmp_ms - ref_ms) if (ref_ms is not None and cmp_ms is not None) else None
        rows.append({
            "corner_num": n,
            "label": c.get("label") or "",
            "direction": c.get("direction") or "",
            "ref": r,
            "compare": x,
            "delta_ms": delta_ms,
        })
    return {
        "corners": rows,
        "source_session": used_session,
        "ref": {"session_id": req.ref.session_id, "lap": req.ref.lap},
        "compare": {"session_id": req.compare.session_id, "lap": req.compare.lap},
    }


@router.post("/sessions/{session_id}/laps/{lap_num}/delta-points")
async def lap_delta_points(
    session_id: str, lap_num: int, req: LapDeltaPointsRequest
):
    """Per-GPS-point delta-seconds vs a reference lap, for painting the track
    map with time-compare colours (RS3 parity — Phase 13.2).

    Returns { lat[], lon[], delta_s[] } where delta_s is (this_lap - ref_lap)
    at each sample position along this lap's driven line. Positive = this
    lap lost time up to that point; negative = gained time.
    """
    # This lap's track
    cmp_dist, cmp_time, cmp_lats, cmp_lons = _lap_distance_time(session_id, lap_num)
    # Reference lap's distance/time (GPS not needed)
    ref_dist, ref_time, _, _ = _lap_distance_time(req.ref.session_id, req.ref.lap)

    cmp_dist_np = np.array(cmp_dist)
    cmp_time_np = np.array(cmp_time)
    ref_dist_np = np.array(ref_dist)
    ref_time_np = np.array(ref_time)

    # For every point on the compare lap, interpolate the reference lap's
    # cumulative time at the same distance. Cap to whichever lap is shorter
    # so we never extrapolate past the end.
    max_dist = float(min(cmp_dist_np[-1], ref_dist_np[-1]))
    capped = np.minimum(cmp_dist_np, max_dist)
    interp_ref_time = np.interp(capped, ref_dist_np, ref_time_np)
    delta_s = cmp_time_np - interp_ref_time

    return {
        "lat": cmp_lats,
        "lon": cmp_lons,
        "delta_s": [round(d, 4) for d in delta_s.tolist()],
        "ref": {
            "session_id": req.ref.session_id,
            "lap": req.ref.lap,
        },
    }
