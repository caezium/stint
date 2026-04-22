"""Smart collections: named session filter queries."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db

router = APIRouter()


class CollectionQuery(BaseModel):
    driver_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    track_id: Optional[int] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    min_laps: Optional[int] = None


class CollectionIn(BaseModel):
    name: str
    query: CollectionQuery


@router.get("/collections")
async def list_collections():
    db = await get_db()
    try:
        cur = await db.execute("SELECT id, name, query_json, created_at FROM smart_collections ORDER BY name")
        rows = await cur.fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "query": json.loads(r["query_json"] or "{}"),
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    finally:
        await db.close()


@router.post("/collections")
async def create_collection(c: CollectionIn):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO smart_collections (name, query_json) VALUES (?, ?)",
            (c.name, json.dumps(c.query.dict())),
        )
        await db.commit()
        return {"id": cur.lastrowid}
    finally:
        await db.close()


@router.put("/collections/{cid}")
async def update_collection(cid: int, c: CollectionIn):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE smart_collections SET name = ?, query_json = ? WHERE id = ?",
            (c.name, json.dumps(c.query.dict()), cid),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.delete("/collections/{cid}")
async def delete_collection(cid: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM smart_collections WHERE id = ?", (cid,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@router.get("/collections/{cid}/sessions")
async def get_collection_sessions(cid: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT query_json, kind FROM smart_collections WHERE id = ?",
            (cid,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Collection not found")
        kind = (row["kind"] if "kind" in row.keys() else "smart") or "smart"

        # Phase 22.1: manual collections use explicit membership rows.
        if kind == "manual":
            cur = await db.execute(
                """SELECT s.* FROM sessions s
                   INNER JOIN manual_collection_members m
                     ON m.session_id = s.id
                   WHERE m.collection_id = ?
                     AND (s.deleted_at IS NULL OR s.deleted_at = '')
                   ORDER BY s.created_at DESC""",
                (cid,),
            )
            return [dict(r) async for r in cur]

        q = json.loads(row["query_json"] or "{}")

        # Exclude soft-deleted sessions from smart collection results too.
        sql = (
            "SELECT * FROM sessions "
            "WHERE (deleted_at IS NULL OR deleted_at = '')"
        )
        params: list = []
        if q.get("driver_id") is not None:
            sql += " AND driver_id = ?"
            params.append(q["driver_id"])
        if q.get("vehicle_id") is not None:
            sql += " AND vehicle_id = ?"
            params.append(q["vehicle_id"])
        if q.get("track_id") is not None:
            sql += " AND track_id = ?"
            params.append(q["track_id"])
        if q.get("date_from"):
            sql += " AND log_date >= ?"
            params.append(q["date_from"])
        if q.get("date_to"):
            sql += " AND log_date <= ?"
            params.append(q["date_to"])
        if q.get("min_laps") is not None:
            sql += " AND lap_count >= ?"
            params.append(q["min_laps"])
        sql += " ORDER BY created_at DESC"

        cur = await db.execute(sql, params)
        return [dict(r) async for r in cur]
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Manual Collections (Phase 22.1)
# ---------------------------------------------------------------------------


class ManualCollectionRequest(BaseModel):
    name: str


@router.post("/manual-collections")
async def create_manual_collection(req: ManualCollectionRequest):
    """Create a new manual collection (name only; membership is added
    via add-session below)."""
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO smart_collections (name, query_json, kind) "
            "VALUES (?, '{}', 'manual')",
            (req.name,),
        )
        await db.commit()
        return {"id": int(cur.lastrowid), "name": req.name}
    finally:
        await db.close()


@router.post("/manual-collections/{cid}/sessions/{session_id}")
async def add_session_to_collection(cid: int, session_id: str):
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR IGNORE INTO manual_collection_members "
            "(collection_id, session_id) VALUES (?, ?)",
            (cid, session_id),
        )
        await db.commit()
        return {"collection_id": cid, "session_id": session_id}
    finally:
        await db.close()


@router.delete("/manual-collections/{cid}/sessions/{session_id}")
async def remove_session_from_collection(cid: int, session_id: str):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM manual_collection_members "
            "WHERE collection_id = ? AND session_id = ?",
            (cid, session_id),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
