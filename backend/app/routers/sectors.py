"""Sector analysis — auto-detect sectors and compute split times."""

import math
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..database import get_db
from ..xrk_service import get_resampled_lap_data

router = APIRouter()


def _haversine_distances(lats, lons):
    """Compute cumulative distance (meters) from lat/lon arrays."""
    R = 6371000
    dists = [0.0]
    for i in range(1, len(lats)):
        lat1, lat2 = math.radians(lats[i - 1]), math.radians(lats[i])
        dlat = lat2 - lat1
        dlon = math.radians(lons[i] - lons[i - 1])
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        dists.append(dists[-1] + R * c)
    return dists


@router.post("/sessions/{session_id}/sectors/auto-detect")
async def auto_detect_sectors(
    session_id: str,
    num_sectors: int = Query(default=3, ge=2, le=10),
):
    """
    Auto-detect sectors by dividing the best lap track into equal-distance segments.
    Computes split times for all laps and stores results in the database.
    """
    db = await get_db()
    try:
        # Find all racing laps
        cursor = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, duration_ms FROM laps WHERE session_id = ? AND num > 0 ORDER BY num",
            (session_id,),
        )
        laps = [dict(row) for row in await cursor.fetchall()]
        if not laps:
            raise HTTPException(404, "No laps found")

        # Find best lap
        best_lap = min(laps, key=lambda l: l["duration_ms"])

        # Get GPS data for the best lap to define sector boundaries
        gps_channels = ["GPS Latitude", "GPS Longitude"]
        table = get_resampled_lap_data(session_id, gps_channels, best_lap["num"])
        if table is None or table.num_rows < 10:
            raise HTTPException(404, "Insufficient GPS data")

        lats = table.column("GPS Latitude").to_pylist()
        lons = table.column("GPS Longitude").to_pylist()
        dists = _haversine_distances(lats, lons)
        total_dist = dists[-1]

        # Define sector boundaries (equal distance)
        sector_defs = []
        for s in range(num_sectors):
            start_d = (s / num_sectors) * total_dist
            end_d = ((s + 1) / num_sectors) * total_dist
            sector_defs.append({
                "sector_num": s + 1,
                "start_distance_m": round(start_d, 2),
                "end_distance_m": round(end_d, 2),
                "label": f"S{s + 1}",
            })

        # Store sector definitions
        await db.execute(
            "DELETE FROM sectors WHERE session_id = ?", (session_id,)
        )
        await db.execute(
            "DELETE FROM sector_times WHERE session_id = ?", (session_id,)
        )

        for sd in sector_defs:
            await db.execute(
                "INSERT INTO sectors (session_id, sector_num, start_distance_m, end_distance_m, label) VALUES (?, ?, ?, ?, ?)",
                (session_id, sd["sector_num"], sd["start_distance_m"], sd["end_distance_m"], sd["label"]),
            )

        # Compute sector times for each lap
        sector_times = []
        for lap in laps:
            lap_table = get_resampled_lap_data(session_id, gps_channels, lap["num"])
            if lap_table is None or lap_table.num_rows < 5:
                continue

            lap_lats = lap_table.column("GPS Latitude").to_pylist()
            lap_lons = lap_table.column("GPS Longitude").to_pylist()
            lap_tc = lap_table.column("timecodes").to_pylist()
            lap_dists = _haversine_distances(lap_lats, lap_lons)

            # For each sector, find the time span
            dist_arr = np.array(lap_dists)
            tc_arr = np.array(lap_tc)

            for sd in sector_defs:
                # Interpolate timecodes at sector boundaries
                start_time = np.interp(sd["start_distance_m"], dist_arr, tc_arr)
                end_time = np.interp(sd["end_distance_m"], dist_arr, tc_arr)
                duration = int(end_time - start_time)
                if duration > 0:
                    sector_times.append({
                        "lap_num": lap["num"],
                        "sector_num": sd["sector_num"],
                        "duration_ms": duration,
                    })
                    await db.execute(
                        "INSERT INTO sector_times (session_id, lap_num, sector_num, duration_ms) VALUES (?, ?, ?, ?)",
                        (session_id, lap["num"], sd["sector_num"], duration),
                    )

        await db.commit()

        return {
            "sectors": sector_defs,
            "sector_times": sector_times,
            "total_distance_m": round(total_dist, 2),
        }
    finally:
        await db.close()


@router.get("/sessions/{session_id}/sectors")
async def get_sectors(session_id: str):
    """Return sector definitions and per-lap split times."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT sector_num, start_distance_m, end_distance_m, label FROM sectors WHERE session_id = ? ORDER BY sector_num",
            (session_id,),
        )
        sectors = [dict(row) for row in await cursor.fetchall()]

        cursor = await db.execute(
            "SELECT lap_num, sector_num, duration_ms FROM sector_times WHERE session_id = ? ORDER BY lap_num, sector_num",
            (session_id,),
        )
        times = [dict(row) for row in await cursor.fetchall()]

        # Compute theoretical best (sum of best sectors)
        best_sectors = {}
        for t in times:
            sn = t["sector_num"]
            if sn not in best_sectors or t["duration_ms"] < best_sectors[sn]:
                best_sectors[sn] = t["duration_ms"]

        theoretical_best = sum(best_sectors.values()) if best_sectors else None

        return {
            "sectors": sectors,
            "sector_times": times,
            "theoretical_best_ms": theoretical_best,
        }
    finally:
        await db.close()
