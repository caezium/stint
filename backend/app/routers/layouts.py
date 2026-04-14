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
