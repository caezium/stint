"""Persistent job queue — tiny in-process worker backed by the job_runs table.

Replaces asyncio fire-and-forget for narrative/plan/auto-title/backfill work so
that a crashed task doesn't silently lose work. Jobs are processed one at a
time per tick; multiple ticks may fire concurrently (lifespan worker + manual
/jobs/tick), and each tick atomically claims its next pending job via
``UPDATE ... WHERE status='pending' AND id=(SELECT MIN(id) ...)``.

Tick interval: 2s from the FastAPI lifespan background task.

Supported kinds:
  - ``narrative``        generate debrief narrative via LLM
  - ``plan``             generate coaching plan via LLM
  - ``auto_title``       infer a conversation title (unused for now; scaffold)
  - ``backfill_session`` re-run anomalies+debrief+coaching+tags+plan on one session
"""

from __future__ import annotations

import asyncio
import traceback
from typing import Optional

from .database import get_db


async def enqueue_job(kind: str, session_id: Optional[str]) -> int:
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO job_runs (session_id, kind, status) VALUES (?, ?, 'pending')",
            (session_id, kind),
        )
        await db.commit()
        return int(cur.lastrowid)
    finally:
        await db.close()


async def _claim_next_job() -> Optional[dict]:
    """Atomically claim one pending job. Returns None if nothing to do."""
    db = await get_db()
    try:
        # Reset stuck 'running' jobs older than 5 minutes — gives crashed
        # workers a path back to the queue.
        await db.execute(
            "UPDATE job_runs SET status='pending' "
            "WHERE status='running' AND started_at < datetime('now','-5 minutes')"
        )
        cur = await db.execute(
            "SELECT id FROM job_runs WHERE status='pending' ORDER BY id LIMIT 1"
        )
        row = await cur.fetchone()
        if not row:
            await db.commit()
            return None
        jid = int(row[0])
        res = await db.execute(
            "UPDATE job_runs SET status='running', started_at=datetime('now'), "
            "attempt=attempt+1 WHERE id=? AND status='pending'",
            (jid,),
        )
        await db.commit()
        if res.rowcount == 0:
            return None  # another worker grabbed it first
        cur = await db.execute(
            "SELECT id, session_id, kind, attempt FROM job_runs WHERE id=?",
            (jid,),
        )
        r = await cur.fetchone()
        return dict(r) if r else None
    finally:
        await db.close()


async def _finish(jid: int, ok: bool, err: Optional[str]) -> None:
    db = await get_db()
    try:
        await db.execute(
            "UPDATE job_runs SET status=?, finished_at=datetime('now'), "
            "error_message=? WHERE id=?",
            ("ok" if ok else "error", err, jid),
        )
        await db.commit()
    finally:
        await db.close()


async def _run_one(job: dict) -> None:
    jid = job["id"]
    kind = job["kind"]
    sid = job["session_id"]
    try:
        if kind == "narrative":
            from . import narrative, debrief
            cached = await debrief.get_cached_debrief(sid)
            if cached:
                await narrative.generate_and_persist_narrative(sid, cached)
        elif kind == "plan":
            from . import plans
            await plans.generate_plan(sid)
        elif kind == "auto_title":
            # Scaffold — conversation auto-title lives in chat_assist; noop for now.
            pass
        elif kind == "backfill_session":
            from .anomalies import detect_session_anomalies
            from .debrief import generate_debrief
            from .coaching import compute_session_coaching_points
            from .tags import compute_session_tags
            from .plans import evaluate_prior_plan, generate_plan
            from .corners import detect_corners
            await detect_session_anomalies(sid)
            await generate_debrief(sid)
            await compute_session_coaching_points(sid)
            await compute_session_tags(sid)
            await evaluate_prior_plan(sid)
            await generate_plan(sid)
            try:
                await detect_corners(sid)
            except Exception:
                pass
        elif kind == "purge_trash":
            # Phase 22.4: hard-delete soft-deleted sessions older than 7 days
            from .database import get_db
            import os
            import shutil
            from .xrk_service import CACHE_DIR
            db = await get_db()
            try:
                cur = await db.execute(
                    "SELECT id FROM sessions "
                    "WHERE deleted_at IS NOT NULL AND deleted_at != '' "
                    "AND datetime(deleted_at) < datetime('now', '-7 days')"
                )
                stale = [r[0] for r in await cur.fetchall()]
                for sid_ in stale:
                    await db.execute("DELETE FROM sessions WHERE id = ?", (sid_,))
                    cache_dir = os.path.join(CACHE_DIR, sid_)
                    if os.path.exists(cache_dir):
                        shutil.rmtree(cache_dir, ignore_errors=True)
                await db.commit()
            finally:
                await db.close()
        elif kind == "fetch_weather":
            # Phase 25: auto-fetch weather for the session log sheet
            from .routers.log_sheets import _fetch_and_persist_weather
            await _fetch_and_persist_weather(sid)
        else:
            raise ValueError(f"unknown job kind: {kind}")
        await _finish(jid, True, None)
    except Exception as e:
        traceback.print_exc()
        await _finish(jid, False, f"{type(e).__name__}: {str(e)[:400]}")


async def worker_tick() -> int:
    """Claim and run one job. Returns 1 if a job was processed, else 0."""
    job = await _claim_next_job()
    if not job:
        return 0
    await _run_one(job)
    return 1


_stop_event: Optional[asyncio.Event] = None
_task: Optional[asyncio.Task] = None


async def _loop() -> None:
    assert _stop_event is not None
    while not _stop_event.is_set():
        try:
            processed = await worker_tick()
        except Exception:
            traceback.print_exc()
            processed = 0
        # When idle, sleep 2s; when busy, loop immediately to drain the queue.
        if processed == 0:
            try:
                await asyncio.wait_for(_stop_event.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass


def start_worker() -> None:
    """Start the background worker task. Idempotent."""
    global _stop_event, _task
    if _task is not None and not _task.done():
        return
    _stop_event = asyncio.Event()
    _task = asyncio.create_task(_loop())


async def stop_worker() -> None:
    global _stop_event, _task
    if _stop_event is not None:
        _stop_event.set()
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except Exception:
            pass
    _stop_event = None
    _task = None
