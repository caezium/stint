"""Driver and vehicle profiles."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..database import get_db

router = APIRouter()


# ---- Drivers ----


class DriverRequest(BaseModel):
    name: str
    weight_kg: float = 0


@router.get("/drivers")
async def list_drivers():
    """List drivers with per-driver session aggregates.

    Includes `session_count`, `last_session_date`, and `best_lap_time_ms`
    derived from the sessions table so the /drivers index page can render
    a useful card without issuing N+1 requests.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT d.id, d.name, d.weight_kg, d.created_at,
                      COUNT(s.id) AS session_count,
                      MAX(s.log_date) AS last_session_date,
                      MIN(CASE WHEN s.best_lap_time_ms > 0 THEN s.best_lap_time_ms END) AS best_lap_time_ms
               FROM drivers d
               LEFT JOIN sessions s ON s.driver_id = d.id
               GROUP BY d.id
               ORDER BY session_count DESC, d.name"""
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


@router.post("/drivers")
async def create_driver(req: DriverRequest):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO drivers (name, weight_kg) VALUES (?, ?)",
            (req.name, req.weight_kg),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": req.name, "weight_kg": req.weight_kg}
    finally:
        await db.close()


@router.delete("/drivers/{driver_id}")
async def delete_driver(driver_id: int):
    db = await get_db()
    try:
        result = await db.execute("DELETE FROM drivers WHERE id = ?", (driver_id,))
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Driver not found")
        return {"deleted": driver_id}
    finally:
        await db.close()


# ---- Vehicles ----


class VehicleRequest(BaseModel):
    name: str
    vehicle_class: str = ""
    engine: str = ""


@router.get("/vehicles")
async def list_vehicles():
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, name, class, engine, created_at FROM vehicles ORDER BY name"
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


@router.post("/vehicles")
async def create_vehicle(req: VehicleRequest):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO vehicles (name, class, engine) VALUES (?, ?, ?)",
            (req.name, req.vehicle_class, req.engine),
        )
        await db.commit()
        return {
            "id": cursor.lastrowid,
            "name": req.name,
            "class": req.vehicle_class,
            "engine": req.engine,
        }
    finally:
        await db.close()


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: int):
    db = await get_db()
    try:
        result = await db.execute("DELETE FROM vehicles WHERE id = ?", (vehicle_id,))
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Vehicle not found")
        return {"deleted": vehicle_id}
    finally:
        await db.close()
