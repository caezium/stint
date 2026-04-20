"""Administrative / destructive operations."""

import os
import shutil

from fastapi import APIRouter, HTTPException

from ..database import get_db
from ..xrk_service import CACHE_DIR, XRK_DIR

router = APIRouter()


# ---------------------------------------------------------------------------
# XRK parse diagnostics — compare raw libxrk output to what we persisted so
# that we can diagnose "laps lost / laptimes wrong" bugs without a re-upload.
# ---------------------------------------------------------------------------


@router.get("/admin/sessions/{session_id}/parse-diagnostics")
async def xrk_parse_diagnostics(session_id: str):
    """Re-read the XRK file with libxrk and diff against persisted laps/channels.

    Returns three sections:
      - `persisted`: sessions row + laps in the DB
      - `raw`: what libxrk currently reports (laps, metadata)
      - `diff`: per-lap duration deltas and any missing/extra lap numbers
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, file_name, driver, vehicle, venue, log_date, log_time, "
            "lap_count, best_lap_time_ms, total_duration_ms "
            "FROM sessions WHERE id = ?",
            (session_id,),
        )
        srow = await cur.fetchone()
        if not srow:
            raise HTTPException(404, f"Session '{session_id}' not found")
        persisted_session = dict(srow)

        cur = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, duration_ms, is_pit_lap "
            "FROM laps WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        persisted_laps = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    # Find the original XRK on disk so we can re-parse it.
    xrk_path = None
    candidate_names = [persisted_session.get("file_name")] if persisted_session.get("file_name") else []
    for name in candidate_names:
        p = os.path.join(XRK_DIR, f"{session_id}_{name}") if name else None
        if p and os.path.exists(p):
            xrk_path = p
            break
    if xrk_path is None and os.path.isdir(XRK_DIR):
        for fname in os.listdir(XRK_DIR):
            if fname.startswith(session_id + "_"):
                xrk_path = os.path.join(XRK_DIR, fname)
                break

    raw = None
    raw_error = None
    if xrk_path:
        try:
            import libxrk  # type: ignore
            log = libxrk.aim_xrk(xrk_path)
            raw_laps = []
            if log.laps and log.laps.num_rows > 0:
                for i in range(log.laps.num_rows):
                    n = log.laps.column("num")[i].as_py()
                    st = log.laps.column("start_time")[i].as_py()
                    en = log.laps.column("end_time")[i].as_py()
                    raw_laps.append({
                        "num": n,
                        "start_time_ms": st,
                        "end_time_ms": en,
                        "duration_ms": en - st,
                    })
            meta = {}
            try:
                for i in range(log.meta.num_rows):
                    k = log.meta.column("key")[i].as_py()
                    v = log.meta.column("value")[i].as_py()
                    meta[k] = v
            except Exception:
                pass
            raw = {"laps": raw_laps, "meta": meta, "path": xrk_path}
        except Exception as e:
            raw_error = str(e)
    else:
        raw_error = "XRK file not found on disk — cannot re-parse"

    # Diff persisted vs raw
    diff: list[dict] = []
    if raw is not None:
        by_num = {l["num"]: l for l in raw["laps"]}
        for p in persisted_laps:
            r = by_num.get(p["num"])
            if r is None:
                diff.append({"num": p["num"], "issue": "persisted but not in raw"})
                continue
            if r["duration_ms"] != p["duration_ms"]:
                diff.append({
                    "num": p["num"],
                    "issue": "duration_mismatch",
                    "persisted_ms": p["duration_ms"],
                    "raw_ms": r["duration_ms"],
                    "delta_ms": r["duration_ms"] - p["duration_ms"],
                })
        persisted_nums = {p["num"] for p in persisted_laps}
        for r in raw["laps"]:
            if r["num"] not in persisted_nums:
                diff.append({"num": r["num"], "issue": "raw has lap not persisted"})

    return {
        "session_id": session_id,
        "persisted": {
            "session": persisted_session,
            "laps": persisted_laps,
        },
        "raw": raw,
        "raw_error": raw_error,
        "diff": diff,
    }


# ---------------------------------------------------------------------------
# Backfill — re-run the post-upload pipeline on every existing session so that
# new signals (distance_pct on anomalies, per-lap fingerprints, coaching
# points, tags, narrative, plans, nudges) populate without re-uploading.
# ---------------------------------------------------------------------------


@router.post("/admin/backfill")
async def backfill_all_sessions():
    """Enqueue a ``backfill_session`` job per session and return immediately.

    The job worker processes sessions one at a time; the frontend polls
    ``GET /api/jobs?kind=backfill_session`` to render a progress bar.
    """
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM sessions ORDER BY log_date DESC")
        ids = [r["id"] for r in await cur.fetchall()]
    finally:
        await db.close()

    from ..jobs import enqueue_job
    job_ids: list[int] = []
    for sid in ids:
        try:
            jid = await enqueue_job("backfill_session", sid)
            job_ids.append(jid)
        except Exception as e:
            print(f"[backfill] enqueue failed for {sid}: {e}")

    return {
        "queued": len(job_ids),
        "session_count": len(ids),
        "kind": "backfill_session",
        "note": "Poll /api/jobs?kind=backfill_session for progress.",
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
