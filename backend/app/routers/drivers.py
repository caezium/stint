"""Driver analytics endpoints — powers /drivers/[name] dashboard."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..database import get_db

router = APIRouter()


@router.get("/drivers/{driver}/summary")
async def driver_summary(driver: str):
    """Aggregate analytics for one driver: session count, venues, PB per venue,
    tag distribution, fingerprint history (fed separately by existing
    /drivers/{name}/fingerprint-stats), and session list.

    Everything computed from the sessions/laps/session_tags/debriefs tables.
    """
    db = await get_db()
    try:
        # Session list (ordered newest first)
        cur = await db.execute(
            """SELECT id, venue, vehicle, log_date, log_time, lap_count,
                      best_lap_time_ms, total_duration_ms
               FROM sessions WHERE driver = ? ORDER BY log_date DESC, log_time DESC""",
            (driver,),
        )
        session_rows = [dict(r) for r in await cur.fetchall()]

        if not session_rows:
            # Return an empty shape rather than 404 so the driver dashboard
            # can render "no sessions" state instead of the browser showing a
            # generic fetch error. Manually-created drivers (via POST /drivers)
            # have no sessions until their first upload arrives.
            return {
                "driver": driver,
                "session_count": 0,
                "sessions": [],
                "tag_counts": {},
                "venues": [],
                "pb_per_venue": {},
                "tags_by_session": {},
            }

        session_ids = [s["id"] for s in session_rows]
        placeholders = ",".join(["?"] * len(session_ids))

        # Tag distribution + per-session tags
        cur = await db.execute(
            f"SELECT session_id, tag FROM session_tags WHERE session_id IN ({placeholders})",
            session_ids,
        )
        tag_rows = [dict(r) for r in await cur.fetchall()]
        tag_counts: dict[str, int] = defaultdict(int)
        tags_by_session: dict[str, list[str]] = defaultdict(list)
        for t in tag_rows:
            tag_counts[t["tag"]] += 1
            tags_by_session[t["session_id"]].append(t["tag"])

        # Per-venue PB (min best_lap_time_ms > 0), plus the session id that set it
        cur = await db.execute(
            f"""SELECT venue, id, best_lap_time_ms, log_date FROM sessions
               WHERE driver = ? AND best_lap_time_ms > 0
               ORDER BY venue, best_lap_time_ms ASC""",
            (driver,),
        )
        venue_rows = [dict(r) for r in await cur.fetchall()]
        pb_per_venue: dict[str, dict] = {}
        for row in venue_rows:
            v = row["venue"] or "(unknown)"
            if v not in pb_per_venue:
                pb_per_venue[v] = {
                    "venue": v,
                    "best_lap_ms": int(row["best_lap_time_ms"]),
                    "session_id": row["id"],
                    "log_date": row["log_date"],
                    "session_count": 0,
                }
            pb_per_venue[v]["session_count"] += 1

        # Compute overall PB
        overall_pb = None
        overall_pb_session = None
        overall_pb_venue = None
        if venue_rows:
            best = min(venue_rows, key=lambda r: r["best_lap_time_ms"])
            overall_pb = int(best["best_lap_time_ms"])
            overall_pb_session = best["id"]
            overall_pb_venue = best["venue"]

        # Fingerprint series over time — one point per session (from lap_fingerprints)
        cur = await db.execute(
            f"""SELECT s.id, s.log_date, s.venue,
                      AVG(lf.throttle_smoothness) AS throttle,
                      AVG(lf.braking_aggressiveness) AS brake,
                      AVG(lf.max_brake) AS max_brake,
                      AVG(lf.steering_smoothness) AS steering
               FROM sessions s
               LEFT JOIN lap_fingerprints lf ON lf.session_id = s.id
               WHERE s.driver = ?
               GROUP BY s.id
               ORDER BY s.log_date ASC""",
            (driver,),
        )
        fp_rows = [dict(r) for r in await cur.fetchall()]
        fingerprint_series = [
            {
                "session_id": r["id"],
                "log_date": r["log_date"],
                "venue": r["venue"],
                "throttle_smoothness": r["throttle"],
                "braking_aggressiveness": r["brake"],
                "max_brake": r["max_brake"],
                "steering_smoothness": r["steering"],
            }
            for r in fp_rows
        ]

        # Assemble session list with tags
        sessions = []
        total_laps = 0
        for s in session_rows:
            total_laps += int(s.get("lap_count") or 0)
            sessions.append({
                **s,
                "tags": tags_by_session.get(s["id"], []),
            })

        return {
            "driver": driver,
            "stats": {
                "session_count": len(session_rows),
                "venue_count": len(pb_per_venue),
                "total_laps": total_laps,
                "overall_pb_ms": overall_pb,
                "overall_pb_session_id": overall_pb_session,
                "overall_pb_venue": overall_pb_venue,
                "last_session_date": session_rows[0]["log_date"] if session_rows else None,
            },
            "tag_counts": dict(tag_counts),
            "pb_per_venue": sorted(
                pb_per_venue.values(), key=lambda x: x["best_lap_ms"],
            ),
            "fingerprint_series": fingerprint_series,
            "sessions": sessions,
        }
    finally:
        await db.close()
