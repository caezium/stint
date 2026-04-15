"""Export endpoints — CSV and PDF report generation."""

import io
import csv
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..database import get_db
from ..xrk_service import get_resampled_lap_data

router = APIRouter()


@router.get("/sessions/{session_id}/export/csv")
async def export_csv(
    session_id: str,
    channels: str = Query(..., description="Comma-separated channel names"),
    lap: int = Query(...),
):
    """Export resampled channel data as a CSV file."""
    channel_list = [c.strip() for c in channels.split(",") if c.strip()]
    if not channel_list:
        raise HTTPException(400, "No channels specified")

    table = get_resampled_lap_data(session_id, channel_list, lap)
    if table is None:
        raise HTTPException(404, "No data found for specified channels/lap")

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)

    col_names = table.column_names
    writer.writerow(col_names)

    # Write rows
    arrays = {name: table.column(name).to_pylist() for name in col_names}
    n_rows = table.num_rows
    for i in range(n_rows):
        writer.writerow([arrays[name][i] for name in col_names])

    output.seek(0)
    safe_name = f"stint_{session_id[:8]}_lap{lap}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.get("/sessions/{session_id}/export/report")
async def export_report(session_id: str):
    """Generate a JSON summary report (lightweight alternative to PDF)."""
    db = await get_db()
    try:
        # Session info
        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        session = await cursor.fetchone()
        if not session:
            raise HTTPException(404, "Session not found")

        # Laps
        cursor = await db.execute(
            "SELECT num, duration_ms FROM laps WHERE session_id = ? AND num > 0 ORDER BY num",
            (session_id,),
        )
        laps = [dict(row) for row in await cursor.fetchall()]

        # Best lap
        best_lap = min(laps, key=lambda l: l["duration_ms"]) if laps else None

        # Channels
        cursor = await db.execute(
            "SELECT name, units, category, sample_count FROM channels WHERE session_id = ? ORDER BY category, name",
            (session_id,),
        )
        channels = [dict(row) for row in await cursor.fetchall()]

        # Sector times if available
        cursor = await db.execute(
            "SELECT sector_num, start_distance_m, end_distance_m, label FROM sectors WHERE session_id = ? ORDER BY sector_num",
            (session_id,),
        )
        sectors = [dict(row) for row in await cursor.fetchall()]

        cursor = await db.execute(
            "SELECT lap_num, sector_num, duration_ms FROM sector_times WHERE session_id = ? ORDER BY lap_num, sector_num",
            (session_id,),
        )
        sector_times = [dict(row) for row in await cursor.fetchall()]

        # Notes
        cursor = await db.execute(
            "SELECT note_text FROM session_notes WHERE session_id = ?",
            (session_id,),
        )
        note_row = await cursor.fetchone()
        notes = note_row["note_text"] if note_row else ""

        return {
            "session": dict(session),
            "laps": laps,
            "best_lap": best_lap,
            "channels": channels,
            "sectors": sectors,
            "sector_times": sector_times,
            "notes": notes,
            "summary": {
                "total_laps": len(laps),
                "total_channels": len(channels),
                "best_lap_ms": best_lap["duration_ms"] if best_lap else None,
            },
        }
    finally:
        await db.close()
