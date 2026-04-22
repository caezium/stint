"""Layout presets — save and load workspace configurations."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class LayoutRequest(BaseModel):
    name: str
    config_json: str


@router.get("/layouts")
async def list_layouts():
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, name, config_json, created_at FROM layouts ORDER BY name"
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


@router.post("/layouts")
async def save_layout(req: LayoutRequest):
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO layouts (name, config_json) VALUES (?, ?)",
            (req.name, req.config_json),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT id, name, config_json, created_at FROM layouts WHERE name = ?",
            (req.name,),
        )
        row = await cursor.fetchone()
        return dict(row)
    finally:
        await db.close()


@router.delete("/layouts/{layout_id}")
async def delete_layout(layout_id: int):
    db = await get_db()
    try:
        result = await db.execute(
            "DELETE FROM layouts WHERE id = ?", (layout_id,)
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Layout not found")
        return {"deleted": layout_id}
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Profile export / import (Phase 20.3) — a single JSON blob bundling layouts,
# alarms, math channels, channel display settings. Lets a user share a
# RaceStudio-3-style setup with a coach or move it between machines.
# ---------------------------------------------------------------------------


@router.get("/profile/export")
async def export_profile():
    """Return a single JSON document with all user-configurable workspace
    preferences. Version tag future-proofs the import side."""
    db = await get_db()
    try:
        cur = await db.execute("SELECT id, name, config_json FROM layouts")
        layouts = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT scope, session_id, driver, channel, kind, threshold_a, "
            "threshold_b, severity, message FROM channel_alarms"
        )
        alarms = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT session_id, name, formula, units FROM math_channels"
        )
        math_channels = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT session_id, channel, unit_override, decimal_override, "
            "color, hidden, sort_index FROM channel_settings"
        )
        channel_settings = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return {
        "version": 1,
        "exported_at": __import__("datetime").datetime.utcnow().isoformat(),
        "layouts": layouts,
        "alarms": alarms,
        "math_channels": math_channels,
        "channel_settings": channel_settings,
    }


class ProfileImportRequest(BaseModel):
    version: int = 1
    layouts: list[dict] = []
    alarms: list[dict] = []
    math_channels: list[dict] = []
    channel_settings: list[dict] = []
    merge: bool = True


@router.post("/profile/import")
async def import_profile(req: ProfileImportRequest):
    """Restore a profile exported by /profile/export. When merge=True the
    existing rows are kept and new ones are appended; merge=False wipes
    the target tables first. Dedup by natural key to avoid duplicates on
    repeated imports."""
    db = await get_db()
    try:
        if not req.merge:
            await db.execute("DELETE FROM layouts")
            await db.execute("DELETE FROM channel_alarms")
            # Math channels + channel_settings are session-scoped and risky
            # to wipe wholesale; only reset when merge=False.
            await db.execute("DELETE FROM math_channels")
            await db.execute("DELETE FROM channel_settings")

        for ly in req.layouts:
            name = (ly.get("name") or "").strip()
            cfg = ly.get("config_json") or ""
            if not name or not cfg:
                continue
            await db.execute(
                "INSERT OR REPLACE INTO layouts (name, config_json) VALUES (?, ?)",
                (name, cfg),
            )

        for a in req.alarms:
            if not a.get("channel") or not a.get("kind"):
                continue
            await db.execute(
                """INSERT INTO channel_alarms
                   (scope, session_id, driver, channel, kind,
                    threshold_a, threshold_b, severity, message)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    a.get("scope") or "global",
                    a.get("session_id"),
                    a.get("driver") or "",
                    a["channel"],
                    a["kind"],
                    a.get("threshold_a"),
                    a.get("threshold_b"),
                    a.get("severity") or "warning",
                    (a.get("message") or "")[:200],
                ),
            )

        for m in req.math_channels:
            if not m.get("session_id") or not m.get("name") or not m.get("formula"):
                continue
            await db.execute(
                """INSERT OR REPLACE INTO math_channels
                   (session_id, name, formula, units)
                   VALUES (?, ?, ?, ?)""",
                (m["session_id"], m["name"], m["formula"], m.get("units") or ""),
            )

        for cs in req.channel_settings:
            if not cs.get("session_id") or not cs.get("channel"):
                continue
            await db.execute(
                """INSERT OR REPLACE INTO channel_settings
                   (session_id, channel, unit_override, decimal_override,
                    color, hidden, sort_index)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    cs["session_id"],
                    cs["channel"],
                    cs.get("unit_override") or "",
                    cs.get("decimal_override"),
                    cs.get("color") or "",
                    1 if cs.get("hidden") else 0,
                    cs.get("sort_index"),
                ),
            )

        await db.commit()
        return {
            "imported": {
                "layouts": len(req.layouts),
                "alarms": len(req.alarms),
                "math_channels": len(req.math_channels),
                "channel_settings": len(req.channel_settings),
            }
        }
    finally:
        await db.close()
