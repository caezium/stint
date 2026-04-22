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
    date_patterns = ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"]
    time_patterns = ["%H:%M:%S", "%H:%M"]
    fmts: list[tuple[str, str]] = []
    for dp in date_patterns:
        for tp in time_patterns:
            fmts.append((f"{dp} {tp}", f"{log_date} {log_time or '12:00:00'}"))
        fmts.append((dp, log_date))
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    candidates: list[int] = []
    for fmt, s in fmts:
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=tz)
            candidates.append(int(dt.timestamp()))
        except ValueError:
            continue
    if not candidates:
        return None
    # Prefer the most recent past timestamp; fall back to the earliest future one.
    past = [ts for ts in candidates if ts <= now_ts]
    if past:
        return max(past)
    return min(candidates)


def _fetch_openweather_timemachine(lat: float, lon: float, dt: int, api_key: str) -> dict:
    """Synchronous call to OpenWeather 3.0 timemachine endpoint."""
    qs = urllib.parse.urlencode({"lat": lat, "lon": lon, "dt": dt, "appid": api_key, "units": "metric"})
    url = f"https://api.openweathermap.org/data/3.0/onecall/timemachine?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "stint/0.1"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_openmeteo_history(lat: float, lon: float, dt: int) -> dict:
    """Keyless historical weather via Open-Meteo archive API.

    Returns a dict shaped like OpenWeather's single-hour result so the caller
    can reuse extraction logic: {"temp": <c>, "weather": [{"description": ...}]}.
    """
    from datetime import datetime as _dt, timezone as _tz
    moment = _dt.fromtimestamp(dt, tz=_tz.utc)
    date_str = moment.strftime("%Y-%m-%d")
    hour_str = moment.strftime("%Y-%m-%dT%H:00")
    qs = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "start_date": date_str,
        "end_date": date_str,
        "hourly": "temperature_2m,weathercode",
    })
    url = f"https://archive-api.open-meteo.com/v1/archive?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "stint/0.1"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    times = (raw.get("hourly") or {}).get("time") or []
    temps = (raw.get("hourly") or {}).get("temperature_2m") or []
    codes = (raw.get("hourly") or {}).get("weathercode") or []
    idx = 0
    for i, t in enumerate(times):
        if t == hour_str:
            idx = i
            break
    temp = temps[idx] if idx < len(temps) else None
    code = codes[idx] if idx < len(codes) else None
    # WMO weather-code → text (abridged)
    wmo = {
        0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
        45: "fog", 48: "depositing rime fog",
        51: "light drizzle", 53: "drizzle", 55: "dense drizzle",
        61: "light rain", 63: "rain", 65: "heavy rain",
        71: "light snow", 73: "snow", 75: "heavy snow",
        80: "rain showers", 81: "heavy showers", 82: "violent showers",
        95: "thunderstorm", 96: "thunderstorm w/ hail", 99: "thunderstorm w/ heavy hail",
    }
    desc = wmo.get(code, f"code {code}" if code is not None else "")
    return {"data": [{"temp": temp, "weather": [{"description": desc}]}]}


async def _fetch_and_persist_weather(session_id: str) -> dict:
    """Shared internal helper so both the /fetch-weather endpoint and the
    `fetch_weather` background job (Phase 25) hit the same code path.

    Returns a dict like the endpoint response, or raises HTTPException on
    user-facing errors / ValueError on programmatic errors. Idempotent:
    existing weather fields on the log sheet are preserved.
    """
    meta = await _get_session_metadata(session_id)
    if not meta:
        raise HTTPException(404, "Session not found")

    latlon = _get_session_latlon(session_id)
    if not latlon:
        raise HTTPException(400, "Session has no GPS data to locate weather")

    dt = _parse_session_datetime(meta["log_date"], meta["log_time"], meta.get("track_tz", ""))
    if not dt:
        raise HTTPException(400, "Session has no log date; cannot fetch historical weather")

    lat, lon = latlon
    api_key = await _get_openweather_key()
    payload: dict | None = None
    errors: list[str] = []
    if api_key:
        try:
            payload = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_openweather_timemachine, lat, lon, dt, api_key
            )
        except Exception as e:
            errors.append(f"OpenWeather: {e}")
    # Fallback to keyless Open-Meteo if OpenWeather returned nothing useful
    def _has_data(p: dict | None) -> bool:
        if not p:
            return False
        d = p.get("data") or p.get("current")
        if isinstance(d, dict):
            return bool(d)
        return bool(d)
    source = "openweather"
    if not _has_data(payload):
        try:
            payload = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_openmeteo_history, lat, lon, dt
            )
            source = "open-meteo"
        except Exception as e:
            errors.append(f"Open-Meteo: {e}")
            raise HTTPException(501, "; ".join(errors) or "Weather fetch failed")

    # Extract fields — shape differs by plan
    data_list = payload.get("data") or payload.get("current") or []
    if isinstance(data_list, dict):
        data_list = [data_list]
    if not data_list:
        raise HTTPException(501, "Weather provider returned no data")
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
        # Track temp: weather providers don't give this; leave existing.
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
        "source": source,
    }


@router.post("/sessions/{session_id}/fetch-weather")
async def fetch_weather(session_id: str):
    return await _fetch_and_persist_weather(session_id)


@router.post("/log-sheets/fetch-weather-all")
async def fetch_weather_all():
    """Retry UI hook (Phase 25.3) — enqueue `fetch_weather` for every session
    that has no weather populated yet. Useful after adding an OpenWeather
    API key, or if Open-Meteo was down during initial upload.
    """
    from ..jobs import enqueue_job
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.id FROM sessions s "
            "LEFT JOIN session_log_sheets ls ON ls.session_id = s.id "
            "WHERE (s.deleted_at IS NULL OR s.deleted_at = '') "
            "AND (ls.weather IS NULL OR ls.weather = '') "
            "ORDER BY s.created_at DESC"
        )
        ids = [r[0] for r in await cur.fetchall()]
    finally:
        await db.close()
    enqueued = 0
    for sid in ids:
        try:
            await enqueue_job("fetch_weather", sid)
            enqueued += 1
        except Exception:
            pass
    return {"enqueued": enqueued, "total_candidates": len(ids)}
