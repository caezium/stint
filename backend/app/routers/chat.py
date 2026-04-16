"""Chat endpoints — conversations + streaming message agent."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..database import get_db
from ..llm_agent import run_chat_turn

router = APIRouter()


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


class CreateConversationRequest(BaseModel):
    session_id: str
    title: str = ""


@router.post("/chat/conversations")
async def create_conversation(req: CreateConversationRequest):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT 1 FROM sessions WHERE id = ?", (req.session_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(404, "Session not found")
        cursor = await db.execute(
            "INSERT INTO chat_conversations (session_id, title) VALUES (?, ?)",
            (req.session_id, req.title),
        )
        new_id = cursor.lastrowid
        await db.commit()
        cursor = await db.execute(
            "SELECT id, session_id, title, created_at, updated_at "
            "FROM chat_conversations WHERE id = ?",
            (new_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else {"id": new_id}
    finally:
        await db.close()


@router.get("/chat/conversations")
async def list_conversations(session_id: str = Query(...)):
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT c.id, c.session_id, c.title, c.created_at, c.updated_at,
                      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
               FROM chat_conversations c
               WHERE c.session_id = ?
               ORDER BY c.updated_at DESC""",
            (session_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


def _flatten_message(role: str, content_json: str) -> Optional[dict]:
    """Convert stored message shapes into a UI-friendly flat object.

    The agent persists:
      user      → {"text": "..."}
      assistant → {"text": "...", "tool_calls": [...]}
    This also handles a couple of legacy shapes so older conversations
    still render if the storage format has changed.
    """
    try:
        content = json.loads(content_json)
    except Exception:
        return None

    if role == "user":
        if isinstance(content, dict) and "text" in content:
            return {"role": "user", "text": content.get("text") or None}
        if isinstance(content, str):
            return {"role": "user", "text": content or None}
        if isinstance(content, list):
            # Legacy Anthropic-style blocks
            text_parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            if not text_parts:
                return None
            return {"role": "user", "text": "\n".join(text_parts).strip() or None}
        return None

    if role == "assistant":
        if isinstance(content, dict):
            ui_calls = []
            for tc in content.get("tool_calls") or []:
                fn = tc.get("function") or {}
                args_raw = fn.get("arguments") or "{}"
                try:
                    args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
                except Exception:
                    args = {}
                ui_calls.append({
                    "tool_use_id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "input": args,
                })
            return {
                "role": "assistant",
                "text": content.get("text") or None,
                "tool_calls": ui_calls or None,
            }
        if isinstance(content, list):
            # Legacy shape
            text_parts, tool_calls = [], []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tool_calls.append({
                        "tool_use_id": block.get("id", ""),
                        "name": block.get("name", ""),
                        "input": block.get("input", {}),
                    })
            return {
                "role": "assistant",
                "text": "\n".join(text_parts).strip() or None,
                "tool_calls": tool_calls or None,
            }
        return None

    return None


@router.get("/chat/conversations/{conversation_id}")
async def get_conversation(conversation_id: int):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, session_id, title, created_at, updated_at FROM chat_conversations WHERE id = ?",
            (conversation_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, "Conversation not found")
        conversation = dict(row)

        cursor = await db.execute(
            "SELECT id, role, content_json, created_at FROM chat_messages "
            "WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()

    messages = []
    for r in rows:
        flat = _flatten_message(r["role"], r["content_json"])
        if flat:
            flat["id"] = r["id"]
            flat["created_at"] = r["created_at"]
            messages.append(flat)
    return {"conversation": conversation, "messages": messages}


@router.delete("/chat/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT 1 FROM chat_conversations WHERE id = ?", (conversation_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(404, "Conversation not found")
        await db.execute(
            "DELETE FROM chat_messages WHERE conversation_id = ?", (conversation_id,)
        )
        await db.execute(
            "DELETE FROM chat_conversations WHERE id = ?", (conversation_id,)
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Streaming message endpoint
# ---------------------------------------------------------------------------


class ChatMessageRequest(BaseModel):
    conversation_id: int
    message: str


@router.post("/chat/message")
async def send_message(req: ChatMessageRequest):
    if not req.message.strip():
        raise HTTPException(400, "Empty message")

    async def stream():
        async for frame in run_chat_turn(req.conversation_id, req.message):
            yield frame

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
