"""Session log sheets: weather, temps, setup notes, etc."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class LogSheet(BaseModel):
    weather: str = ""
    track_temp: float = 0
    air_temp: float = 0
    tire_pressures_json: str = ""
    setup_notes: str = ""
    fuel_level: float = 0
    driver_rating: int = 0


@router.get("/sessions/{session_id}/log-sheet")
async def get_log_sheet(session_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT weather, track_temp, air_temp, tire_pressures_json, setup_notes, fuel_level, driver_rating "
            "FROM session_log_sheets WHERE session_id = ?", (session_id,),
        )
        row = await cur.fetchone()
        if not row:
            return LogSheet().dict()
        return dict(row)
    finally:
        await db.close()


@router.put("/sessions/{session_id}/log-sheet")
async def put_log_sheet(session_id: str, sheet: LogSheet):
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Session not found")
        await db.execute(
            """INSERT INTO session_log_sheets
               (session_id, weather, track_temp, air_temp, tire_pressures_json,
                setup_notes, fuel_level, driver_rating, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(session_id) DO UPDATE SET
                 weather=excluded.weather,
                 track_temp=excluded.track_temp,
                 air_temp=excluded.air_temp,
                 tire_pressures_json=excluded.tire_pressures_json,
                 setup_notes=excluded.setup_notes,
                 fuel_level=excluded.fuel_level,
                 driver_rating=excluded.driver_rating,
                 updated_at=datetime('now')""",
            (
                session_id, sheet.weather, sheet.track_temp, sheet.air_temp,
                sheet.tire_pressures_json, sheet.setup_notes, sheet.fuel_level,
                sheet.driver_rating,
            ),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
