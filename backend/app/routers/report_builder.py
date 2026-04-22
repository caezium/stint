"""Report Builder — user-defined channel × stat × filter reports with
per-report PDF export and batch zip download. (Phase 23)"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..database import get_db
from ..xrk_service import get_resampled_lap_data

router = APIRouter()


_SUPPORTED_STATS = {"min", "max", "avg", "p50", "p90", "p99", "std", "count"}


class ReportSpec(BaseModel):
    name: Optional[str] = None
    channels: list[str]
    stats: list[str] = ["min", "max", "avg", "p90"]
    lap_filter: str = "all"  # all | clean | clean_no_pit
    session_ids: Optional[list[str]] = None


class TemplateIn(BaseModel):
    driver: str = ""
    name: str
    spec: ReportSpec


def _validate_spec(spec: ReportSpec) -> None:
    if not spec.channels:
        raise HTTPException(400, "spec.channels must not be empty")
    bad = [s for s in spec.stats if s not in _SUPPORTED_STATS]
    if bad:
        raise HTTPException(
            400, f"unsupported stat(s): {bad}. Supported: {sorted(_SUPPORTED_STATS)}"
        )


def _fmt_stat(v: Optional[float], stat: str) -> str:
    if v is None:
        return "—"
    if stat == "count":
        return str(int(v))
    if abs(v) >= 100:
        return f"{v:.0f}"
    if abs(v) >= 10:
        return f"{v:.1f}"
    return f"{v:.2f}"


async def _compute_report_for_session(session_id: str, spec: ReportSpec) -> dict:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT num, duration_ms, is_pit_lap FROM laps "
            "WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        laps = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT driver, venue, log_date, best_lap_time_ms FROM sessions "
            "WHERE id = ?",
            (session_id,),
        )
        meta = await cur.fetchone()
    finally:
        await db.close()

    if not meta:
        raise HTTPException(404, f"session {session_id} not found")
    sm = dict(meta)

    # Apply lap filter
    racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
    if spec.lap_filter == "clean_no_pit":
        racing = [l for l in racing if not l.get("is_pit_lap")]
    elif spec.lap_filter == "clean":
        # Clean = within 15% of best
        if racing:
            best = min(l["duration_ms"] for l in racing)
            racing = [l for l in racing if l["duration_ms"] <= best * 1.15]

    def compute(values: np.ndarray) -> dict:
        out = {}
        if values.size == 0:
            for s in spec.stats:
                out[s] = None
            return out
        for s in spec.stats:
            if s == "min":
                out[s] = float(np.min(values))
            elif s == "max":
                out[s] = float(np.max(values))
            elif s == "avg":
                out[s] = float(np.mean(values))
            elif s == "p50":
                out[s] = float(np.percentile(values, 50))
            elif s == "p90":
                out[s] = float(np.percentile(values, 90))
            elif s == "p99":
                out[s] = float(np.percentile(values, 99))
            elif s == "std":
                out[s] = float(np.std(values))
            elif s == "count":
                out[s] = int(values.size)
        return out

    session_wide_bins: dict[str, list[np.ndarray]] = {c: [] for c in spec.channels}
    lap_rows: list[dict] = []
    for lap in racing:
        table = get_resampled_lap_data(session_id, spec.channels, lap["num"])
        cells: dict[str, dict] = {}
        for c in spec.channels:
            if table is None:
                cells[c] = {s: None for s in spec.stats}
                continue
            try:
                col = np.asarray(table.column(c).to_pylist(), dtype=np.float64)
                col = col[np.isfinite(col)]
            except Exception:
                col = np.asarray([], dtype=np.float64)
            cells[c] = compute(col)
            if col.size:
                session_wide_bins[c].append(col)
        lap_rows.append({
            "num": lap["num"],
            "duration_ms": lap["duration_ms"],
            "is_pit_lap": bool(lap.get("is_pit_lap")),
            "cells": cells,
        })

    session_wide: dict[str, dict] = {}
    for c, chunks in session_wide_bins.items():
        session_wide[c] = compute(np.concatenate(chunks)) if chunks else {s: None for s in spec.stats}

    return {
        "session_id": session_id,
        "session_meta": sm,
        "channels": spec.channels,
        "stats": spec.stats,
        "lap_filter": spec.lap_filter,
        "laps": lap_rows,
        "session_wide": session_wide,
    }


@router.post("/reports/render")
async def render_report(spec: ReportSpec):
    """Return the computed report(s) as JSON — one per session in spec."""
    _validate_spec(spec)
    session_ids = spec.session_ids or []
    if not session_ids:
        raise HTTPException(400, "spec.session_ids must contain at least one session")
    reports = []
    for sid in session_ids:
        try:
            reports.append(await _compute_report_for_session(sid, spec))
        except HTTPException:
            raise
        except Exception as e:
            reports.append({"session_id": sid, "error": str(e)})
    return {"spec": spec.model_dump(), "reports": reports}


def _render_pdf(reports: list[dict], spec: ReportSpec) -> bytes:
    """Render the computed reports as a PDF via ReportLab."""
    try:
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate,
            Paragraph,
            Spacer,
            Table,
            TableStyle,
        )
        from reportlab.lib.styles import getSampleStyleSheet
    except ImportError:
        raise HTTPException(500, "reportlab is not installed")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(letter),
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph(f"<b>{spec.name or 'Report'}</b>", styles["Heading1"]))
    story.append(
        Paragraph(
            f"Channels: {', '.join(spec.channels)} · Stats: {', '.join(spec.stats)} "
            f"· Lap filter: {spec.lap_filter}",
            styles["BodyText"],
        )
    )
    story.append(Spacer(1, 12))

    for r in reports:
        if r.get("error"):
            story.append(
                Paragraph(
                    f"Session {r['session_id']}: ERROR — {r['error']}",
                    styles["BodyText"],
                )
            )
            continue
        meta = r.get("session_meta") or {}
        story.append(
            Paragraph(
                f"<b>{meta.get('venue', '?')}</b> · {meta.get('driver', '?')} · {meta.get('log_date', '')}",
                styles["Heading2"],
            )
        )
        # Build header rows
        header_top = ["Lap", "Time"]
        header_bot = ["", ""]
        for c in r["channels"]:
            for i, s in enumerate(r["stats"]):
                header_top.append(c if i == 0 else "")
                header_bot.append(s)
        data = [header_top, header_bot]
        for lap in r["laps"]:
            row = [
                f"L{lap['num']}" + (" · pit" if lap.get("is_pit_lap") else ""),
                f"{lap['duration_ms']/1000:.3f}s" if lap["duration_ms"] > 0 else "—",
            ]
            for c in r["channels"]:
                for s in r["stats"]:
                    row.append(_fmt_stat(lap["cells"].get(c, {}).get(s), s))
            data.append(row)
        # Session-wide row
        row = ["Session", "—"]
        for c in r["channels"]:
            for s in r["stats"]:
                row.append(_fmt_stat(r["session_wide"].get(c, {}).get(s), s))
        data.append(row)

        t = Table(data, repeatRows=2)
        t.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 1), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, 1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("ALIGN", (2, 2), (-1, -1), "RIGHT"),
                ("BACKGROUND", (0, -1), (-1, -1), colors.whitesmoke),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Oblique"),
            ])
        )
        story.append(t)
        story.append(Spacer(1, 18))

    doc.build(story)
    return buf.getvalue()


@router.post("/reports/render-pdf")
async def render_report_pdf(spec: ReportSpec):
    _validate_spec(spec)
    session_ids = spec.session_ids or []
    if not session_ids:
        raise HTTPException(400, "spec.session_ids must contain at least one session")
    reports = []
    for sid in session_ids:
        try:
            reports.append(await _compute_report_for_session(sid, spec))
        except Exception as e:
            reports.append({"session_id": sid, "error": str(e)})
    pdf = _render_pdf(reports, spec)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{(spec.name or "report").replace(" ", "_")}.pdf"'
            )
        },
    )


class BatchExportRequest(BaseModel):
    session_ids: list[str]
    formats: list[str] = ["csv", "json"]


@router.post("/sessions/export-bulk")
async def export_bulk(req: BatchExportRequest):
    """Zip up per-session CSV / JSON summaries for a set of sessions.

    Each session contributes:
      - {id}.json — minimal summary (driver, venue, laps, best lap)
      - {id}.csv  — lap times table
    """
    ids = req.session_ids or []
    if not ids:
        raise HTTPException(400, "session_ids must not be empty")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        db = await get_db()
        try:
            placeholders = ",".join(["?"] * len(ids))
            cur = await db.execute(
                f"SELECT * FROM sessions WHERE id IN ({placeholders})",
                ids,
            )
            sessions = {r["id"]: dict(r) for r in await cur.fetchall()}
            for sid in ids:
                if sid not in sessions:
                    continue
                sm = sessions[sid]
                cur = await db.execute(
                    "SELECT num, duration_ms, is_pit_lap FROM laps "
                    "WHERE session_id = ? ORDER BY num",
                    (sid,),
                )
                laps = [dict(r) for r in await cur.fetchall()]

                if "json" in req.formats:
                    summary = {
                        "id": sid,
                        "driver": sm.get("driver"),
                        "vehicle": sm.get("vehicle"),
                        "venue": sm.get("venue"),
                        "log_date": sm.get("log_date"),
                        "lap_count": sm.get("lap_count"),
                        "best_lap_time_ms": sm.get("best_lap_time_ms"),
                        "laps": laps,
                    }
                    zf.writestr(f"{sid}.json", json.dumps(summary, indent=2))

                if "csv" in req.formats:
                    sio = io.StringIO()
                    w = csv.writer(sio)
                    w.writerow(["lap_num", "duration_ms", "is_pit_lap"])
                    for l in laps:
                        w.writerow([l["num"], l["duration_ms"], int(bool(l.get("is_pit_lap")))])
                    zf.writestr(f"{sid}.csv", sio.getvalue())
        finally:
            await db.close()

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="stint-export.zip"'},
    )


# ---------------------------------------------------------------------------
# Report templates (Phase 23.4)
# ---------------------------------------------------------------------------


@router.get("/report-templates")
async def list_templates(driver: Optional[str] = None):
    db = await get_db()
    try:
        q = "SELECT id, driver, name, spec_json, created_at FROM report_templates WHERE 1=1"
        params: list = []
        if driver:
            q += " AND (driver = ? OR driver = '')"
            params.append(driver)
        q += " ORDER BY name"
        cur = await db.execute(q, params)
        rows = []
        for r in await cur.fetchall():
            d = dict(r)
            try:
                d["spec"] = json.loads(d.pop("spec_json"))
            except Exception:
                d["spec"] = None
            rows.append(d)
        return rows
    finally:
        await db.close()


@router.post("/report-templates")
async def create_template(req: TemplateIn):
    _validate_spec(req.spec)
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO report_templates (driver, name, spec_json) VALUES (?, ?, ?)",
            (req.driver, req.name, json.dumps(req.spec.model_dump())),
        )
        await db.commit()
        return {"id": int(cur.lastrowid)}
    finally:
        await db.close()


@router.delete("/report-templates/{template_id}")
async def delete_template(template_id: int):
    db = await get_db()
    try:
        res = await db.execute(
            "DELETE FROM report_templates WHERE id = ?", (template_id,)
        )
        await db.commit()
        if res.rowcount == 0:
            raise HTTPException(404, "template not found")
        return {"deleted": template_id}
    finally:
        await db.close()
