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
