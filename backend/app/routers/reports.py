"""Multi-session reports."""

import statistics

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
                "SELECT duration_ms FROM laps "
                "WHERE session_id = ? AND num > 0 AND duration_ms > 0",
                (sid,),
            )
            durations = [int(r["duration_ms"]) async for r in cur2]

            best_ms = min(durations) if durations else None
            avg_ms = int(sum(durations) / len(durations)) if durations else None
            median_ms = int(statistics.median(durations)) if durations else None
            stddev_ms = (
                int(statistics.pstdev(durations)) if len(durations) >= 2 else None
            )

            # Theoretical best = sum of min sector times per sector
            cur3 = await db.execute(
                "SELECT sector_num, MIN(duration_ms) as best "
                "FROM sector_times WHERE session_id = ? GROUP BY sector_num",
                (sid,),
            )
            sector_bests = [int(r["best"]) async for r in cur3 if r["best"] is not None]
            theoretical_best_ms = (
                int(sum(sector_bests)) if sector_bests else None
            )

            out.append({
                "session_id": sid,
                "file_name": s["file_name"],
                "driver": s["driver"],
                "venue": s["venue"],
                "log_date": s["log_date"],
                "lap_count": s["lap_count"],
                "best_lap_ms": best_ms,
                "avg_lap_ms": avg_ms,
                "median_lap_ms": median_ms,
                "stddev_lap_ms": stddev_ms,
                "theoretical_best_ms": theoretical_best_ms,
                "counted_laps": len(durations),
            })
        return {"sessions": out}
    finally:
        await db.close()
