"""User settings — simple key/value store."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class SettingValue(BaseModel):
    value: str


@router.get("/settings/{key}")
async def get_setting(key: str):
    db = await get_db()
    try:
        cur = await db.execute("SELECT value FROM user_settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return {"key": key, "value": row["value"] if row else ""}
    finally:
        await db.close()


@router.put("/settings/{key}")
async def put_setting(key: str, body: SettingValue):
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO user_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, body.value),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.get("/settings")
async def get_all_settings():
    db = await get_db()
    try:
        cur = await db.execute("SELECT key, value FROM user_settings")
        rows = await cur.fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        await db.close()


async def get_setting_value(key: str, default: str = "") -> str:
    db = await get_db()
    try:
        cur = await db.execute("SELECT value FROM user_settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row["value"] if row else default
    finally:
        await db.close()
