"""Default GPS-derived math channels: driver intent, combined G, etc."""

import math
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ..xrk_service import get_resampled_lap_data

router = APIRouter()


DEFAULT_MATH_CHANNELS = [
    {"name": "DriverIntent", "units": "state", "category": "Math (Default)",
     "description": "0=CST, 1=BRK, 2=TPS, 3=CRN"},
    {"name": "CombinedG", "units": "g", "category": "Math (Default)"},
    {"name": "LateralLoadTransfer", "units": "indicator", "category": "Math (Default)"},
    {"name": "TractivePower", "units": "kW", "category": "Math (Default)"},
]


def _get_col(table, *candidates):
    for c in candidates:
        if c in table.column_names:
            return np.array(table.column(c).to_pylist(), dtype=np.float64)
    return None


def _compute_all(session_id: str, lap: int) -> dict:
    wanted = [
        "GPS Speed", "GPS_Speed", "GPS LonAcc", "GPS_LonAcc",
        "GPS LatAcc", "GPS_LatAcc", "GPS Heading", "GPS_Heading",
    ]
    table = get_resampled_lap_data(session_id, wanted, lap)
    if table is None or table.num_rows == 0:
        raise HTTPException(404, "No data for this lap")

    tc = np.array(table.column("timecodes").to_pylist(), dtype=np.float64)
    lon_acc = _get_col(table, "GPS LonAcc", "GPS_LonAcc")
    lat_acc = _get_col(table, "GPS LatAcc", "GPS_LatAcc")
    speed = _get_col(table, "GPS Speed", "GPS_Speed")

    n = len(tc)

    # Driver intent state
    driver_intent: list[int] = []
    if lon_acc is not None and lat_acc is not None:
        for i in range(n):
            la = lat_acc[i]
            lo = lon_acc[i]
            if lo < -0.15:
                driver_intent.append(1)  # BRK
            elif lo > 0.15 and abs(la) < 0.5:
                driver_intent.append(2)  # TPS
            elif abs(la) > 0.5:
                driver_intent.append(3)  # CRN
            else:
                driver_intent.append(0)  # CST
    else:
        driver_intent = [0] * n

    # Combined G
    combined_g: list[float] = []
    if lon_acc is not None and lat_acc is not None:
        combined_g = list(np.sqrt(lon_acc**2 + lat_acc**2))

    # Lateral load transfer indicator (simple proxy: lat_acc * |speed|)
    llt: list[float] = []
    if lat_acc is not None and speed is not None:
        llt = list(lat_acc * np.abs(speed) / 100.0)

    # Tractive power estimate: speed (m/s) * lon_acc (m/s^2) * mass(assumed 200kg kart+driver)
    tractive: list[float] = []
    if speed is not None and lon_acc is not None:
        # speed likely km/h; convert
        speed_ms = speed / 3.6
        # lon_acc in g; convert to m/s^2
        acc_ms2 = lon_acc * 9.81
        tractive = list(speed_ms * acc_ms2 * 200.0 / 1000.0)  # kW

    return {
        "timecodes": [t - tc[0] for t in tc.tolist()] if n else [],
        "DriverIntent": driver_intent,
        "CombinedG": [round(v, 3) for v in combined_g] if combined_g else [],
        "LateralLoadTransfer": [round(v, 3) for v in llt] if llt else [],
        "TractivePower": [round(v, 2) for v in tractive] if tractive else [],
    }


@router.get("/sessions/{session_id}/math-defaults")
async def get_math_defaults(
    session_id: str,
    lap: int = Query(..., description="Lap number"),
    channel: Optional[str] = Query(None, description="Specific default channel"),
):
    data = _compute_all(session_id, lap)
    if channel:
        if channel not in data:
            raise HTTPException(404, f"Unknown default math channel: {channel}")
        return {"timecodes": data["timecodes"], channel: data[channel]}
    return data


@router.get("/math-defaults/registry")
async def math_defaults_registry():
    return DEFAULT_MATH_CHANNELS
