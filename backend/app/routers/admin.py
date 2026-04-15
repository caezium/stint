"""Administrative / destructive operations."""

import os
import shutil

from fastapi import APIRouter

from ..database import get_db
from ..xrk_service import CACHE_DIR, XRK_DIR

router = APIRouter()


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
