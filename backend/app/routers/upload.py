"""File upload endpoint."""

from fastapi import APIRouter, UploadFile, HTTPException
from ..database import get_db
from ..xrk_service import parse_and_cache

router = APIRouter()

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


async def persist_session(db, result: dict) -> None:
    """Upsert a parsed session and replace its child metadata atomically."""
    await db.execute(
        """INSERT INTO sessions
           (id, file_name, driver, vehicle, venue, log_date, log_time,
            session_name, series, logger_model, logger_id,
            lap_count, best_lap_time_ms, total_duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             file_name = excluded.file_name,
             driver = excluded.driver,
             vehicle = excluded.vehicle,
             venue = excluded.venue,
             log_date = excluded.log_date,
             log_time = excluded.log_time,
             session_name = excluded.session_name,
             series = excluded.series,
             logger_model = excluded.logger_model,
             logger_id = excluded.logger_id,
             lap_count = excluded.lap_count,
             best_lap_time_ms = excluded.best_lap_time_ms,
             total_duration_ms = excluded.total_duration_ms""",
        (result["session_id"], result.get("file_name", ""),
         result.get("driver", ""), result.get("vehicle", ""),
         result.get("venue", ""), result.get("log_date", ""),
         result.get("log_time", ""), result.get("session_name", ""),
         result.get("series", ""), result.get("logger_model", ""),
         result.get("logger_id", 0), result.get("lap_count", 0),
         result.get("best_lap_time_ms", 0), result.get("total_duration_ms", 0))
    )

    # Refresh child rows so cache/schema updates do not leave stale records behind.
    await db.execute("DELETE FROM channels WHERE session_id = ?", (result["session_id"],))
    await db.execute("DELETE FROM laps WHERE session_id = ?", (result["session_id"],))

    await db.executemany(
        """INSERT INTO channels
           (session_id, name, units, dec_pts, sample_count, interpolate, function_name, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                result["session_id"],
                ch["name"],
                ch["units"],
                ch["dec_pts"],
                ch["sample_count"],
                ch["interpolate"],
                ch["function_name"],
                ch["category"],
            )
            for ch in result.get("channels", [])
        ],
    )

    await db.executemany(
        """INSERT INTO laps
           (session_id, num, start_time_ms, end_time_ms, duration_ms)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (
                result["session_id"],
                lap["num"],
                lap["start_time_ms"],
                lap["end_time_ms"],
                lap["duration_ms"],
            )
            for lap in result.get("laps", [])
        ],
    )


@router.post("/upload")
async def upload_file(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = file.filename.lower().split(".")[-1]
    if ext not in ("xrk", "xrz"):
        raise HTTPException(400, f"Unsupported file type: .{ext}. Upload .xrk or .xrz files.")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Empty file")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large. Maximum upload size is 100 MB.")

    try:
        result = parse_and_cache(content, file.filename)
    except Exception as e:
        raise HTTPException(500, f"Failed to parse file: {str(e)}")

    # Insert into database
    db = await get_db()
    try:
        await persist_session(db, result)
        await db.commit()
    finally:
        await db.close()

    return {
        "session_id": result["session_id"],
        "driver": result.get("driver", ""),
        "venue": result.get("venue", ""),
        "lap_count": result.get("lap_count", 0),
        "channel_count": len(result.get("channels", [])),
    }
