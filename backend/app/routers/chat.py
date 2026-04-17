"""Chat endpoints — conversations + streaming message agent (AI SDK v5)."""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from ..database import get_db
from ..llm_agent import (
    UI_MESSAGE_STREAM_HEADERS,
    maybe_autotitle_conversation,
    run_chat_turn,
)

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
async def list_conversations(session_id: Optional[str] = Query(default=None)):
    """List chat conversations. Defaults to all conversations across the
    local archive (for the /chat page); pass ``session_id`` to scope to one
    session (used by the in-session chat panel)."""
    db = await get_db()
    try:
        base = (
            "SELECT c.id, c.session_id, c.title, c.created_at, c.updated_at, "
            "       (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count, "
            "       s.venue AS session_venue, s.driver AS session_driver, "
            "       s.log_date AS session_log_date "
            "FROM chat_conversations c "
            "LEFT JOIN sessions s ON s.id = c.session_id"
        )
        if session_id:
            cursor = await db.execute(
                base + " WHERE c.session_id = ? ORDER BY c.updated_at DESC",
                (session_id,),
            )
        else:
            cursor = await db.execute(
                base + " ORDER BY c.updated_at DESC LIMIT 500",
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


def _to_ui_message(row_id: int, role: str, content_json: str, created_at: str) -> Optional[dict]:
    """Project a stored row into an AI-SDK UIMessage. Handles both new and
    legacy persistence shapes so old conversations keep rendering.
    """
    try:
        content = json.loads(content_json)
    except Exception:
        return None

    # New shape persisted by llm_agent._save_uimessage
    if isinstance(content, dict) and isinstance(content.get("parts"), list):
        return {
            "id": str(row_id),
            "role": role,
            "parts": content["parts"],
            "createdAt": created_at,
        }

    # ---- Legacy shapes ----
    parts: list[dict] = []
    if role == "user":
        text = ""
        if isinstance(content, dict) and "text" in content:
            text = content.get("text") or ""
        elif isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        if text:
            parts.append({"type": "text", "text": text})

    elif role == "assistant":
        if isinstance(content, dict):
            if content.get("text"):
                parts.append({"type": "text", "text": content["text"]})
            for tc in content.get("tool_calls") or []:
                fn = tc.get("function") or {}
                args_raw = fn.get("arguments") or "{}"
                try:
                    args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
                except Exception:
                    args = {}
                name = fn.get("name", "")
                parts.append({
                    "type": f"tool-{name}",
                    "toolCallId": tc.get("id", ""),
                    "toolName": name,
                    "state": "input-available",
                    "input": args,
                })
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    parts.append({"type": "text", "text": block.get("text", "")})
                elif block.get("type") == "tool_use":
                    name = block.get("name", "")
                    parts.append({
                        "type": f"tool-{name}",
                        "toolCallId": block.get("id", ""),
                        "toolName": name,
                        "state": "input-available",
                        "input": block.get("input", {}),
                    })

    if not parts:
        return None

    return {
        "id": str(row_id),
        "role": role,
        "parts": parts,
        "createdAt": created_at,
    }


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
            "SELECT id, role, content_json, created_at, tokens_in, tokens_out, model "
            "FROM chat_messages WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()

    messages: list[dict] = []
    for r in rows:
        ui = _to_ui_message(r["id"], r["role"], r["content_json"], r["created_at"])
        if ui:
            # Decorate with token usage for cost display (T3.7)
            ui["metadata"] = {
                "tokensIn": r["tokens_in"],
                "tokensOut": r["tokens_out"],
                "model": r["model"],
            }
            messages.append(ui)
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
# Streaming message endpoint (AI SDK v5 UI message stream)
# ---------------------------------------------------------------------------


class ChatContext(BaseModel):
    pinned_lap: Optional[int] = None
    pinned_distance_m: Optional[float] = None
    visible_channels: Optional[list[str]] = None
    zoom_range: Optional[list[float]] = None  # [min, max] in seconds or meters


class ChatMessageRequest(BaseModel):
    conversation_id: int
    message: str
    context: Optional[ChatContext] = None


@router.post("/chat/message")
async def send_message(req: ChatMessageRequest, request: Request):
    if not req.message.strip():
        raise HTTPException(400, "Empty message")

    chat_context = req.context.model_dump() if req.context else None

    async def stream():
        async for frame in run_chat_turn(
            req.conversation_id,
            req.message,
            chat_context=chat_context,
            is_disconnected=request.is_disconnected,
        ):
            yield frame
        # Fire-and-forget auto-titling after the first user message
        try:
            await maybe_autotitle_conversation(req.conversation_id, req.message)
        except Exception:
            pass

    return StreamingResponse(
        stream(),
        headers=UI_MESSAGE_STREAM_HEADERS,
    )


# ---------------------------------------------------------------------------
# Conversation export as Markdown (T3.6)
# ---------------------------------------------------------------------------


@router.get("/chat/conversations/{conversation_id}/export.md")
async def export_conversation_markdown(conversation_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT title, created_at FROM chat_conversations WHERE id = ?",
            (conversation_id,),
        )
        conv = await cur.fetchone()
        if not conv:
            raise HTTPException(404, "Conversation not found")
        cur = await db.execute(
            "SELECT id, role, content_json, created_at FROM chat_messages "
            "WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    lines: list[str] = [f"# {conv['title'] or 'Stint chat'}", "", f"_{conv['created_at']}_", ""]
    for r in rows:
        ui = _to_ui_message(r["id"], r["role"], r["content_json"], r["created_at"])
        if not ui:
            continue
        who = "**You**" if ui["role"] == "user" else "**Stint**"
        lines.append(who)
        for p in ui["parts"]:
            t = p.get("type", "")
            if t == "text":
                lines.append(p.get("text", ""))
            elif t.startswith("tool-"):
                summary = p.get("summary") or p.get("toolName", t)
                lines.append(f"> tool · {p.get('toolName', '')} — {summary}")
        lines.append("")
    return Response(content="\n".join(lines), media_type="text/markdown")
