"""Multi-session reports."""

from fastapi import APIRouter, Query

from ..database import get_db

router = APIRouter()


@router.get("/reports/multi-session")
async def multi_session_report(session_ids: str = Query(..., description="Comma-separated session ids")):
    ids = [s.strip() for s in session_ids.split(",") if s.strip()]
    if not ids:
        return {"sessions": []}

    placeholders = ",".join("?" for _ in ids)
    db = await get_db()
    try:
        cur = await db.execute(
            f"SELECT id, file_name, driver, venue, log_date, lap_count, best_lap_time_ms "
            f"FROM sessions WHERE id IN ({placeholders})",
            ids,
        )
        sessions = [dict(r) async for r in cur]

        out = []
        for s in sessions:
            sid = s["id"]
            cur2 = await db.execute(
                "SELECT AVG(duration_ms) as avg_ms, MIN(duration_ms) as best_ms, COUNT(*) as cnt "
                "FROM laps WHERE session_id = ? AND num > 0 AND duration_ms > 0",
                (sid,),
            )
            row = await cur2.fetchone()
            out.append({
                "session_id": sid,
                "file_name": s["file_name"],
                "driver": s["driver"],
                "venue": s["venue"],
                "log_date": s["log_date"],
                "lap_count": s["lap_count"],
                "best_lap_ms": int(row["best_ms"]) if row and row["best_ms"] else None,
                "avg_lap_ms": int(row["avg_ms"]) if row and row["avg_ms"] else None,
                "counted_laps": int(row["cnt"]) if row else 0,
            })
        return {"sessions": out}
    finally:
        await db.close()
