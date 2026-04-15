"""Cross-session comparison endpoints."""

import math

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..xrk_service import get_resampled_lap_data

router = APIRouter()


class LapRef(BaseModel):
    session_id: str
    lap: int


class CompareDeltaRequest(BaseModel):
    ref: LapRef
    compare: LapRef


def _lap_distance_time(session_id: str, lap: int):
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
    return dist, time_s


@router.post("/compare/delta-t")
async def cross_session_delta_t(req: CompareDeltaRequest):
    """
    Rolling time delta between two laps (possibly from different sessions)
    in the distance domain. Positive delta = compare lap is slower.
    """
    ref_dist, ref_time = _lap_distance_time(req.ref.session_id, req.ref.lap)
    cmp_dist, cmp_time = _lap_distance_time(req.compare.session_id, req.compare.lap)

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
