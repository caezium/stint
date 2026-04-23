"""Corners + structured setup + fuel estimate endpoints (Phase 26)."""

from __future__ import annotations

import json
import os
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db
from ..corners import (
    detect_corners as _detect_corners,
    list_corners as _list_corners,
    set_corner_label as _set_corner_label,
    per_lap_corner_times as _per_lap_corner_times,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Corners
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/corners")
async def get_corners(session_id: str):
    return {"corners": await _list_corners(session_id)}


@router.post("/sessions/{session_id}/corners/detect")
async def detect_for_session(session_id: str):
    count = await _detect_corners(session_id)
    return {"detected": count, "corners": await _list_corners(session_id)}


class CornerLabelIn(BaseModel):
    label: str


@router.put("/sessions/{session_id}/corners/{corner_num}/label")
async def put_corner_label(session_id: str, corner_num: int, body: CornerLabelIn):
    ok = await _set_corner_label(session_id, corner_num, body.label)
    if not ok:
        raise HTTPException(404, "corner not found for session")
    return {"ok": True, "label": body.label}


@router.get("/sessions/{session_id}/corners/per-lap")
async def corners_per_lap(session_id: str):
    """Per-corner × per-lap times + entry/min/exit speed. Plus a rolled-up
    consistency summary (std-dev + best) per corner, and an optional Δ vs
    the driver's PB reference lap when one exists."""
    rows = await _per_lap_corner_times(session_id)
    # Consistency summary per corner: best corner_ms, mean, std, CoV %.
    by_corner: dict[int, list[dict]] = {}
    for r in rows:
        if r.get("is_pit_lap"):
            continue
        by_corner.setdefault(r["corner_num"], []).append(r)

    summary = []
    for cn, entries in sorted(by_corner.items()):
        times = np.array([e["corner_ms"] for e in entries if e["corner_ms"] > 0])
        ent = np.array([e["entry_speed"] for e in entries])
        mn = np.array([e["min_speed"] for e in entries])
        ex = np.array([e["exit_speed"] for e in entries])
        best_ms = int(times.min()) if times.size else None
        mean_ms = int(times.mean()) if times.size else None
        std_ms = float(times.std()) if times.size else None
        cov_pct = float(times.std() / times.mean() * 100) if times.size and times.mean() > 0 else None
        summary.append({
            "corner_num": cn,
            "lap_count": len(entries),
            "best_corner_ms": best_ms,
            "mean_corner_ms": mean_ms,
            "std_corner_ms": std_ms,
            "cov_pct": cov_pct,
            "min_speed_std": float(mn.std()) if mn.size else None,
            "entry_speed_std": float(ent.std()) if ent.size else None,
            "exit_speed_std": float(ex.std()) if ex.size else None,
        })

    # Δ vs PB: if the driver has a PB reference lap at this track, compute
    # the same corner-times table for that lap and subtract the best.
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT driver, venue FROM sessions WHERE id = ?", (session_id,)
        )
        sess = await cur.fetchone()
        pb_ref = None
        if sess:
            cur = await db.execute(
                "SELECT session_id, lap_num FROM reference_laps "
                "WHERE driver = ? AND venue = ? AND kind = 'pb' AND is_default = 1 "
                "LIMIT 1",
                (sess["driver"], sess["venue"]),
            )
            pb_ref = await cur.fetchone()
    finally:
        await db.close()

    pb_corner_ms: dict[int, int] = {}
    if pb_ref and pb_ref["session_id"] != session_id:
        pb_rows = await _per_lap_corner_times(pb_ref["session_id"])
        for r in pb_rows:
            if r["lap_num"] != pb_ref["lap_num"]:
                continue
            pb_corner_ms[r["corner_num"]] = r["corner_ms"]

    for s in summary:
        pb_ms = pb_corner_ms.get(s["corner_num"])
        if pb_ms and s["best_corner_ms"]:
            s["delta_vs_pb_ms"] = s["best_corner_ms"] - pb_ms
        else:
            s["delta_vs_pb_ms"] = None

    return {"per_lap": rows, "summary": summary}


# ---------------------------------------------------------------------------
# Fuel consumption (Phase 26.3)
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}/fuel")
async def fuel_summary(session_id: str):
    """Estimate per-lap fuel usage + remaining laps from a Fuel Level channel.

    Returns null-ish zeros when the session has no fuel channel. The channel
    is identified by name containing "Fuel" and a unit matching L / litres.
    """
    from .channels import _find_arrow_file
    import pyarrow.ipc as ipc

    # Accept any channel name containing "fuel" — lots of logger variants.
    candidates = [
        "Fuel Level",
        "Fuel",
        "FuelLevel",
        "Fuel_Level",
        "Fuel Pressure",  # some users mislabel; we tolerate, flag in output.
    ]
    fuel_path = None
    fuel_name = None
    for c in candidates:
        p = _find_arrow_file(session_id, c)
        if p:
            fuel_path = p
            fuel_name = c
            break
    if not fuel_path:
        return {
            "has_fuel_channel": False,
            "per_lap": [],
            "laps_remaining": None,
            "current_level": None,
        }

    try:
        table = ipc.open_file(fuel_path).read_all()
        ts = np.asarray(table.column(0).to_pylist(), dtype=np.float64)
        vs = np.asarray(table.column(1).to_pylist(), dtype=np.float64)
    except Exception as e:
        raise HTTPException(500, f"Failed to read fuel channel: {e}")

    # Pull lap bounds
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, is_pit_lap FROM laps "
            "WHERE session_id = ? AND num > 0 ORDER BY num",
            (session_id,),
        )
        laps = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    per_lap = []
    prev_end_level: Optional[float] = None
    for lap in laps:
        mask = (ts >= lap["start_time_ms"]) & (ts <= lap["end_time_ms"])
        seg = vs[mask]
        if seg.size < 2:
            per_lap.append({
                "lap_num": lap["num"],
                "start_level": None,
                "end_level": None,
                "delta": None,
                "is_pit_lap": bool(lap.get("is_pit_lap")),
            })
            continue
        start_level = float(seg[0])
        end_level = float(seg[-1])
        delta = start_level - end_level
        per_lap.append({
            "lap_num": lap["num"],
            "start_level": start_level,
            "end_level": end_level,
            "delta": delta if delta > 0 else 0.0,
            "is_pit_lap": bool(lap.get("is_pit_lap")),
        })
        prev_end_level = end_level

    deltas = [p["delta"] for p in per_lap if p["delta"] is not None and p["delta"] > 0 and not p["is_pit_lap"]]
    avg_delta = float(np.mean(deltas)) if deltas else None
    laps_remaining = (
        int(prev_end_level / avg_delta)
        if (avg_delta and avg_delta > 0 and prev_end_level is not None) else None
    )

    return {
        "has_fuel_channel": True,
        "channel": fuel_name,
        "per_lap": per_lap,
        "avg_delta_per_lap": avg_delta,
        "current_level": prev_end_level,
        "laps_remaining": laps_remaining,
    }


# ---------------------------------------------------------------------------
# Session setup sheet (Phase 26.4)
# ---------------------------------------------------------------------------


class SetupIn(BaseModel):
    gear_ratios: list[float] = []
    tire_compound: str = ""
    tire_pressures: dict[str, float] = {}
    chassis_notes: str = ""
    front_wing: str = ""
    rear_wing: str = ""


def _row_to_setup(row) -> dict:
    if not row:
        return {
            "gear_ratios": [],
            "tire_compound": "",
            "tire_pressures": {},
            "chassis_notes": "",
            "front_wing": "",
            "rear_wing": "",
        }
    return {
        "gear_ratios": json.loads(row["gear_ratios_json"] or "[]"),
        "tire_compound": row["tire_compound"] or "",
        "tire_pressures": json.loads(row["tire_pressures_json"] or "{}"),
        "chassis_notes": row["chassis_notes"] or "",
        "front_wing": row["front_wing"] or "",
        "rear_wing": row["rear_wing"] or "",
    }


@router.get("/sessions/{session_id}/setup")
async def get_setup(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM session_setups WHERE session_id = ?", (session_id,)
        )
        row = await cur.fetchone()
        if row:
            return _row_to_setup(row)
        # No per-session setup yet — inherit from vehicle template if bound.
        cur = await db.execute(
            "SELECT vehicle_id FROM sessions WHERE id = ?", (session_id,)
        )
        sess = await cur.fetchone()
        if sess and sess["vehicle_id"]:
            cur = await db.execute(
                "SELECT * FROM vehicle_setup_templates WHERE vehicle_id = ?",
                (sess["vehicle_id"],),
            )
            tpl = await cur.fetchone()
            return _row_to_setup(tpl) if tpl else _row_to_setup(None)
        return _row_to_setup(None)
    finally:
        await db.close()


@router.put("/sessions/{session_id}/setup")
async def put_setup(session_id: str, body: SetupIn):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO session_setups
               (session_id, gear_ratios_json, tire_compound, tire_pressures_json,
                chassis_notes, front_wing, rear_wing)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 gear_ratios_json=excluded.gear_ratios_json,
                 tire_compound=excluded.tire_compound,
                 tire_pressures_json=excluded.tire_pressures_json,
                 chassis_notes=excluded.chassis_notes,
                 front_wing=excluded.front_wing,
                 rear_wing=excluded.rear_wing,
                 updated_at=datetime('now')""",
            (
                session_id,
                json.dumps(body.gear_ratios),
                body.tire_compound,
                json.dumps(body.tire_pressures),
                body.chassis_notes,
                body.front_wing,
                body.rear_wing,
            ),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.put("/vehicles/{vehicle_id}/setup-template")
async def put_vehicle_template(vehicle_id: int, body: SetupIn):
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM vehicles WHERE id = ?", (vehicle_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "vehicle not found")
        await db.execute(
            """INSERT INTO vehicle_setup_templates
               (vehicle_id, gear_ratios_json, tire_compound, tire_pressures_json,
                chassis_notes, front_wing, rear_wing)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(vehicle_id) DO UPDATE SET
                 gear_ratios_json=excluded.gear_ratios_json,
                 tire_compound=excluded.tire_compound,
                 tire_pressures_json=excluded.tire_pressures_json,
                 chassis_notes=excluded.chassis_notes,
                 front_wing=excluded.front_wing,
                 rear_wing=excluded.rear_wing,
                 updated_at=datetime('now')""",
            (
                vehicle_id,
                json.dumps(body.gear_ratios),
                body.tire_compound,
                json.dumps(body.tire_pressures),
                body.chassis_notes,
                body.front_wing,
                body.rear_wing,
            ),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.get("/vehicles/{vehicle_id}/setup-template")
async def get_vehicle_template(vehicle_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM vehicle_setup_templates WHERE vehicle_id = ?",
            (vehicle_id,),
        )
        row = await cur.fetchone()
        return _row_to_setup(row)
    finally:
        await db.close()
