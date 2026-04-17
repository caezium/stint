"""Administrative / destructive operations."""

import os
import shutil

from fastapi import APIRouter

from ..database import get_db
from ..xrk_service import CACHE_DIR, XRK_DIR

router = APIRouter()


# ---------------------------------------------------------------------------
# Backfill — re-run the post-upload pipeline on every existing session so that
# new signals (distance_pct on anomalies, per-lap fingerprints, coaching
# points, tags, narrative, plans, nudges) populate without re-uploading.
# ---------------------------------------------------------------------------


@router.post("/admin/backfill")
async def backfill_all_sessions():
    """Re-run anomaly detection, debrief, coaching points, tags, nudge, and
    plan generation on every session in the local DB. Each step is best-effort
    per session so a single failure doesn't stop the loop.
    """
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM sessions ORDER BY log_date DESC")
        ids = [r["id"] for r in await cur.fetchall()]
    finally:
        await db.close()

    counts = {
        "anomalies": 0,
        "debrief": 0,
        "coaching": 0,
        "tags": 0,
        "nudge": 0,
        "plan": 0,
    }
    errors: list[dict] = []

    for sid in ids:
        try:
            from ..anomalies import detect_session_anomalies
            await detect_session_anomalies(sid)
            counts["anomalies"] += 1
        except Exception as e:
            errors.append({"step": "anomalies", "session": sid, "error": str(e)})

        try:
            from ..debrief import generate_debrief
            await generate_debrief(sid)
            counts["debrief"] += 1
        except Exception as e:
            errors.append({"step": "debrief", "session": sid, "error": str(e)})

        try:
            from ..coaching import compute_session_coaching_points
            await compute_session_coaching_points(sid)
            counts["coaching"] += 1
        except Exception as e:
            errors.append({"step": "coaching", "session": sid, "error": str(e)})

        try:
            from ..tags import compute_session_tags
            await compute_session_tags(sid)
            counts["tags"] += 1
        except Exception as e:
            errors.append({"step": "tags", "session": sid, "error": str(e)})

        try:
            from .chat_assist import maybe_create_nudge
            await maybe_create_nudge(sid)
            counts["nudge"] += 1
        except Exception as e:
            errors.append({"step": "nudge", "session": sid, "error": str(e)})

        try:
            from ..plans import evaluate_prior_plan, generate_plan
            await evaluate_prior_plan(sid)
            await generate_plan(sid)
            counts["plan"] += 1
        except Exception as e:
            errors.append({"step": "plan", "session": sid, "error": str(e)})

    return {
        "session_count": len(ids),
        "counts": counts,
        "error_count": len(errors),
        "errors": errors[:20],  # cap response size
    }


@router.delete("/admin/sessions")
async def clear_all_sessions():
    """Remove ALL sessions, laps, log sheets, and purge xrk/cache data dirs.

    Destructive — intended to be called from a confirmed user action on the
    settings page. Cache and xrk directories are recreated empty afterwards.
    """
    db = await get_db()
    try:
        # Tables referencing sessions via ON DELETE CASCADE (or plain FKs) are
        # cleaned via a session delete; also wipe standalone tables explicitly.
        tables = [
            "session_log_sheets",
            "session_notes",
            "sector_times",
            "sectors",
            "math_channels",
            "laps",
            "channels",
            "sessions",
        ]
        for t in tables:
            try:
                await db.execute(f"DELETE FROM {t}")
            except Exception:
                # If a table doesn't exist yet, skip it.
                pass
        await db.commit()
    finally:
        await db.close()

    removed_dirs: list[str] = []
    for d in (CACHE_DIR, XRK_DIR):
        if os.path.isdir(d):
            try:
                shutil.rmtree(d)
                removed_dirs.append(d)
            except Exception:
                pass
        os.makedirs(d, exist_ok=True)

    return {"ok": True, "purged": removed_dirs}
