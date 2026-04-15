"""Session log sheets: weather, temps, setup notes, etc."""

import asyncio
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

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


async def _get_openweather_key() -> str:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT value FROM user_settings WHERE key = ?", ("openweather_api_key",)
        )
        row = await cur.fetchone()
        return (row["value"] if row else "") or ""
    finally:
        await db.close()


async def _get_session_metadata(session_id: str) -> dict | None:
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT s.id, s.log_date, s.log_time, t.timezone AS track_tz
               FROM sessions s LEFT JOIN tracks t ON s.track_id = t.id
               WHERE s.id = ?""",
            (session_id,),
        )
        row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "log_date": row["log_date"] or "",
            "log_time": row["log_time"] or "",
            "track_tz": (row["track_tz"] or "") if "track_tz" in row.keys() else "",
        }
    finally:
        await db.close()


def _get_session_latlon(session_id: str) -> tuple[float, float] | None:
    """Best-effort: pull first GPS sample from cached Arrow files."""
    try:
        from .channels import _find_arrow_file
        import pyarrow.ipc as ipc
        lat_path = _find_arrow_file(session_id, "GPS Latitude") or _find_arrow_file(session_id, "GPS_Latitude")
        lon_path = _find_arrow_file(session_id, "GPS Longitude") or _find_arrow_file(session_id, "GPS_Longitude")
        if not lat_path or not lon_path:
            return None
        lat_table = ipc.open_file(lat_path).read_all()
        lon_table = ipc.open_file(lon_path).read_all()
        if lat_table.num_rows == 0 or lon_table.num_rows == 0:
            return None
        lat = lat_table.column(1).to_pylist()[0]
        lon = lon_table.column(1).to_pylist()[0]
        if lat == 0 and lon == 0:
            return None
        return float(lat), float(lon)
    except Exception:
        return None


def _parse_session_datetime(log_date: str, log_time: str, track_tz: str = "") -> int | None:
    """Parse session date/time into a UNIX timestamp.

    The log timestamp is interpreted as local wall-clock time at the track.
    If ``track_tz`` (an IANA zone name like "Europe/London") is provided and
    resolvable, that zone is used; otherwise we fall back to UTC.
    """
    if not log_date:
        return None
    tz: timezone | "ZoneInfo" = timezone.utc
    if track_tz and ZoneInfo is not None:
        try:
            tz = ZoneInfo(track_tz)  # type: ignore[assignment]
        except Exception:
            tz = timezone.utc
    fmts = [
        ("%Y-%m-%d %H:%M:%S", f"{log_date} {log_time or '12:00:00'}"),
        ("%Y-%m-%d %H:%M", f"{log_date} {log_time or '12:00'}"),
        ("%Y-%m-%d", log_date),
    ]
    for fmt, s in fmts:
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=tz)
            return int(dt.timestamp())
        except ValueError:
            continue
    return None


def _fetch_openweather_timemachine(lat: float, lon: float, dt: int, api_key: str) -> dict:
    """Synchronous call to OpenWeather 3.0 timemachine endpoint."""
    qs = urllib.parse.urlencode({"lat": lat, "lon": lon, "dt": dt, "appid": api_key, "units": "metric"})
    url = f"https://api.openweathermap.org/data/3.0/onecall/timemachine?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "stint/0.1"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


@router.post("/sessions/{session_id}/fetch-weather")
async def fetch_weather(session_id: str):
    meta = await _get_session_metadata(session_id)
    if not meta:
        raise HTTPException(404, "Session not found")

    api_key = await _get_openweather_key()
    if not api_key:
        raise HTTPException(
            400,
            "OpenWeather API key not configured. Set user_settings.openweather_api_key.",
        )

    latlon = _get_session_latlon(session_id)
    if not latlon:
        raise HTTPException(400, "Session has no GPS data to locate weather")

    dt = _parse_session_datetime(meta["log_date"], meta["log_time"], meta.get("track_tz", ""))
    if not dt:
        raise HTTPException(400, "Session has no log date; cannot fetch historical weather")

    lat, lon = latlon
    try:
        payload = await asyncio.get_event_loop().run_in_executor(
            None, _fetch_openweather_timemachine, lat, lon, dt, api_key
        )
    except Exception as e:
        raise HTTPException(
            501,
            f"OpenWeather call failed: {e}. Verify key, plan, and network access.",
        )

    # Extract fields — shape differs by plan
    data_list = payload.get("data") or payload.get("current") or []
    if isinstance(data_list, dict):
        data_list = [data_list]
    if not data_list:
        raise HTTPException(501, "OpenWeather returned no data")
    first = data_list[0]
    air_temp = first.get("temp")
    weather = ""
    w = first.get("weather")
    if isinstance(w, list) and w:
        weather = w[0].get("description", "") or w[0].get("main", "") or ""

    # Merge into existing log sheet only if empty
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT weather, track_temp, air_temp FROM session_log_sheets WHERE session_id = ?",
            (session_id,),
        )
        row = await cur.fetchone()
        existing_weather = row["weather"] if row else ""
        existing_air = row["air_temp"] if row else 0
        existing_track = row["track_temp"] if row else 0

        new_weather = existing_weather or weather
        new_air = existing_air if existing_air else (float(air_temp) if air_temp is not None else 0)
        # Track temp: OpenWeather doesn't provide; leave existing.
        new_track = existing_track

        await db.execute(
            """INSERT INTO session_log_sheets
               (session_id, weather, track_temp, air_temp, tire_pressures_json,
                setup_notes, fuel_level, driver_rating, updated_at)
               VALUES (?, ?, ?, ?, '', '', 0, 0, datetime('now'))
               ON CONFLICT(session_id) DO UPDATE SET
                 weather=excluded.weather,
                 track_temp=excluded.track_temp,
                 air_temp=excluded.air_temp,
                 updated_at=datetime('now')""",
            (session_id, new_weather, new_track, new_air),
        )
        await db.commit()
    finally:
        await db.close()

    return {
        "ok": True,
        "weather": new_weather,
        "air_temp": new_air,
        "track_temp": new_track,
        "source": "openweather",
    }
