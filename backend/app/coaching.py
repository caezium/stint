"""Prescriptive coaching points (T2.1).

Per (lap, sector), compute three concrete metrics that drivers can act on:

* braking_point — first sample with brake pressure above threshold (or velocity
  derivative if no brake channel) within the sector window.
* apex_metrics — local minimum of GPS Speed inside the sector.
* throttle_pickup — first sample with TPS > 80% after the apex.

For each metric, we also compare against the same metric on the per-sector
best lap so the LLM can phrase coaching as "you braked 18 m earlier than your
best in S2 and lost 0.15 s".

Persisted to the `coaching_points` table for cheap retrieval by the agent
tool `get_coaching_points`.
"""

from __future__ import annotations

import json
import math
from typing import Optional

import numpy as np

from .channels import haversine_cumdist, list_channels, match_channel
from .database import get_db
from .xrk_service import get_resampled_lap_data


BRAKE_ON_THRESHOLD = 5.0    # bar / % depending on car
THROTTLE_ON_THRESHOLD = 80.0  # %


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def _fetch_sectors(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT sector_num, start_distance_m, end_distance_m FROM sectors "
            "WHERE session_id = ? ORDER BY sector_num",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def _fetch_sector_times(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT lap_num, sector_num, duration_ms FROM sector_times "
            "WHERE session_id = ? ORDER BY lap_num, sector_num",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


async def _fetch_racing_laps(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT num FROM laps WHERE session_id = ? AND num > 0 "
            "AND duration_ms > 0 AND COALESCE(is_pit_lap, 0) = 0 ORDER BY num",
            (session_id,),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Per-lap analysis
# ---------------------------------------------------------------------------


def _lap_distance_array(table) -> Optional[np.ndarray]:
    """Cumulative distance (m) along a lap. Uses GPS lat/lon if present."""
    if "GPS Latitude" in table.column_names and "GPS Longitude" in table.column_names:
        lats = np.array(table.column("GPS Latitude").to_pylist(), dtype=np.float64)
        lons = np.array(table.column("GPS Longitude").to_pylist(), dtype=np.float64)
        if len(lats) >= 2:
            return haversine_cumdist(lats, lons)
    # Fallback: integrate speed if available
    if "GPS Speed" in table.column_names:
        speed_kph = np.array(table.column("GPS Speed").to_pylist(), dtype=np.float64)
        tc = np.array(table.column("timecodes").to_pylist(), dtype=np.float64)
        if len(speed_kph) >= 2:
            dt_s = np.maximum(np.diff(tc) / 1000.0, 0.001)
            d = (speed_kph[:-1] / 3.6) * dt_s
            return np.concatenate([[0.0], np.cumsum(d)])
    return None


def _compute_lap_sector_points(
    session_id: str, lap_num: int, sectors: list[dict], channels: list[str]
) -> list[dict]:
    brake_ch = match_channel(channels, ["BrakePress", "Brake Pressure", "Brake"])
    tps_ch = match_channel(channels, ["TPS", "Throttle"])
    speed_ch = match_channel(channels, ["GPS Speed", "Speed"])

    wanted = ["GPS Latitude", "GPS Longitude"]
    for c in (brake_ch, tps_ch, speed_ch):
        if c and c not in wanted:
            wanted.append(c)
    table = get_resampled_lap_data(session_id, wanted, lap_num)
    if table is None or table.num_rows < 50:
        return []

    dist = _lap_distance_array(table)
    if dist is None or len(dist) < 10:
        return []
    n = len(dist)

    def col(name: Optional[str]) -> Optional[np.ndarray]:
        if not name or name not in table.column_names:
            return None
        return np.array(table.column(name).to_pylist(), dtype=np.float64)[:n]

    brake = col(brake_ch)
    tps = col(tps_ch)
    speed = col(speed_ch)

    out: list[dict] = []
    for sec in sectors:
        sn = int(sec["sector_num"])
        s_d = float(sec.get("start_distance_m") or 0.0)
        e_d = float(sec.get("end_distance_m") or dist[-1])
        if e_d <= s_d:
            continue
        mask = (dist >= s_d) & (dist <= e_d)
        if int(np.sum(mask)) < 5:
            continue
        idx = np.where(mask)[0]

        sector_payload: dict = {}

        if brake is not None:
            b_seg = brake[idx]
            on = np.where(b_seg > BRAKE_ON_THRESHOLD)[0]
            if on.size:
                first = idx[on[0]]
                sector_payload["brake_on_distance_m"] = round(float(dist[first]), 1)
                sector_payload["brake_on_distance_into_sector_m"] = round(
                    float(dist[first] - s_d), 1
                )
                sector_payload["peak_brake_pressure"] = round(float(np.max(b_seg)), 2)

        if speed is not None:
            s_seg = speed[idx]
            mn = int(np.argmin(s_seg))
            sector_payload["apex_speed"] = round(float(s_seg[mn]), 1)
            sector_payload["apex_distance_m"] = round(float(dist[idx[mn]]), 1)
            sector_payload["apex_distance_into_sector_m"] = round(
                float(dist[idx[mn]] - s_d), 1
            )
            apex_local = mn
        else:
            apex_local = 0

        if tps is not None and apex_local < idx.size:
            t_seg = tps[idx]
            after = t_seg[apex_local:]
            on_tps = np.where(after > THROTTLE_ON_THRESHOLD)[0]
            if on_tps.size:
                pickup_local = apex_local + int(on_tps[0])
                sector_payload["throttle_pickup_distance_m"] = round(
                    float(dist[idx[pickup_local]]), 1
                )
                sector_payload["throttle_pickup_distance_into_sector_m"] = round(
                    float(dist[idx[pickup_local]] - s_d), 1
                )

        if sector_payload:
            sector_payload["sector_num"] = sn
            sector_payload["lap_num"] = int(lap_num)
            out.append(sector_payload)
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def compute_session_coaching_points(session_id: str) -> list[dict]:
    sectors = await _fetch_sectors(session_id)
    if not sectors:
        return []
    laps = await _fetch_racing_laps(session_id)
    if not laps:
        return []
    channels = list_channels(session_id)

    all_points: list[dict] = []
    for lap in laps:
        try:
            pts = _compute_lap_sector_points(session_id, int(lap["num"]), sectors, channels)
        except Exception:
            continue
        all_points.extend(pts)

    # Identify per-sector best (fastest sector_time)
    sector_times = await _fetch_sector_times(session_id)
    by_sector_best: dict[int, dict] = {}
    for st in sector_times:
        sn = int(st["sector_num"])
        if sn not in by_sector_best or st["duration_ms"] < by_sector_best[sn]["duration_ms"]:
            by_sector_best[sn] = st

    # Annotate each point with delta vs the best-sector lap's same metric
    by_lap_sector: dict[tuple[int, int], dict] = {
        (int(p["lap_num"]), int(p["sector_num"])): p for p in all_points
    }
    for p in all_points:
        sn = int(p["sector_num"])
        ref = by_sector_best.get(sn)
        if not ref:
            continue
        ref_pt = by_lap_sector.get((int(ref["lap_num"]), sn))
        if not ref_pt or ref_pt is p:
            continue
        for src, dest in (
            ("brake_on_distance_m", "brake_on_delta_m"),
            ("apex_speed", "apex_speed_delta"),
            ("throttle_pickup_distance_m", "throttle_pickup_delta_m"),
        ):
            if src in p and src in ref_pt:
                p[dest] = round(float(p[src]) - float(ref_pt[src]), 2)
        p["best_sector_lap"] = int(ref["lap_num"])

    await _persist(session_id, all_points)
    return all_points


async def _persist(session_id: str, points: list[dict]) -> None:
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM coaching_points WHERE session_id = ?", (session_id,)
        )
        rows = [
            (
                session_id,
                int(p.get("lap_num") or 0),
                int(p.get("sector_num") or 0),
                "sector",
                json.dumps(p, default=str),
            )
            for p in points
        ]
        if rows:
            await db.executemany(
                """INSERT INTO coaching_points
                   (session_id, lap_num, sector_num, kind, payload_json)
                   VALUES (?, ?, ?, ?, ?)""",
                rows,
            )
        await db.commit()
    finally:
        await db.close()


async def get_coaching_points(
    session_id: str, lap_num: Optional[int] = None, sector_num: Optional[int] = None
) -> list[dict]:
    db = await get_db()
    try:
        sql = "SELECT payload_json FROM coaching_points WHERE session_id = ?"
        params: list = [session_id]
        if lap_num is not None:
            sql += " AND lap_num = ?"
            params.append(int(lap_num))
        if sector_num is not None:
            sql += " AND sector_num = ?"
            params.append(int(sector_num))
        sql += " ORDER BY lap_num, sector_num"
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    finally:
        await db.close()
    out: list[dict] = []
    for r in rows:
        try:
            out.append(json.loads(r["payload_json"]))
        except Exception:
            continue
    return out
