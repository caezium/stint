"""
LLM agent: streaming chat loop via OpenRouter (OpenAI-compatible API).

Architecture:
    user → run_chat_turn() yields SSE events
        → OpenRouter chat.completions.create(stream=True, tools=...)
        → on tool_calls in stream: accumulate, then run execute_tool()
        → append tool results as role='tool' messages
        → continue loop until finish_reason != "tool_calls"
    Conversation + messages persisted to DB on turn completion.

Default model: anthropic/claude-sonnet-4.5 (routed through OpenRouter).
Override via STINT_LLM_MODEL env var.

The openai SDK is imported lazily so the rest of the backend still works
if the dependency is not yet installed.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, Optional

from .database import get_db
from .llm_tools import TOOL_SCHEMAS, execute_tool


DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
MAX_TOOL_ITERATIONS = 8
MAX_TOKENS = 2048

SYSTEM_PROMPT = """You are Stint's racing telemetry analyst. You help amateur racers understand their on-track data.

CONTEXT
You are scoped to a single telemetry session. Every tool call operates on that
session automatically — you never need to ask for or pass a session_id.

STYLE
- Answer in plain language a driver can act on. Lap times in mm:ss.SSS format.
- When citing specific points in the data, mention the lap number and where in
  the lap (distance %, sector, or channel value).
- If the user asks a vague question, start with get_session_overview and then
  get_debrief to orient yourself before drilling in.
- Prefer aggregate stats (get_lap_stats, get_debrief, compare_laps_delta) over
  raw channel samples. Only use sample_channel_on_lap when you need to show
  WHERE in the lap something happened.
- Be concise. 1-3 short paragraphs is ideal. Bullet lists for comparisons.
- If a tool returns an error, tell the user honestly and suggest what would
  answer their question instead.

LIMITS
- You only see this user's one session. Don't invent other sessions.
- Don't fabricate numbers — if you don't have a tool result backing a claim,
  don't make the claim.
"""


async def _get_api_key() -> Optional[str]:
    """Fetch the OpenRouter API key. Priority: env var → user_settings table."""
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT value FROM user_settings WHERE key = ?", ("openrouter_api_key",)
        )
        row = await cursor.fetchone()
        return (row["value"] or "").strip() if row else None
    finally:
        await db.close()


def _sse(event: dict) -> str:
    """Format an SSE `data:` frame."""
    return f"data: {json.dumps(event)}\n\n"


async def _load_history(conversation_id: int) -> list[dict]:
    """Reconstruct OpenAI-format message history from the DB.

    The DB stores rich content blocks; we translate them back into the
    flat shape OpenAI expects: text messages, assistant tool_calls, and
    role='tool' responses.
    """
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT role, content_json FROM chat_messages "
            "WHERE conversation_id = ? ORDER BY id",
            (conversation_id,),
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()

    messages: list[dict] = []
    for r in rows:
        try:
            content = json.loads(r["content_json"])
        except Exception:
            continue

        if r["role"] == "user":
            # Stored as either {"text": ...} or a list of content blocks.
            if isinstance(content, dict) and "text" in content:
                messages.append({"role": "user", "content": content["text"]})
            elif isinstance(content, list):
                # Could be tool_result blocks or text blocks
                tool_results = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]
                text_blocks = [b for b in content if isinstance(b, dict) and b.get("type") == "text"]
                if tool_results:
                    for tr in tool_results:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tr.get("tool_use_id", ""),
                            "content": tr.get("content", ""),
                        })
                if text_blocks:
                    messages.append({
                        "role": "user",
                        "content": "\n".join(b.get("text", "") for b in text_blocks),
                    })
            else:
                messages.append({"role": "user", "content": str(content)})

        elif r["role"] == "assistant":
            # Stored as {text, tool_calls} or list of blocks
            if isinstance(content, dict):
                msg: dict[str, Any] = {"role": "assistant"}
                if content.get("text"):
                    msg["content"] = content["text"]
                if content.get("tool_calls"):
                    msg["tool_calls"] = content["tool_calls"]
                if "content" not in msg:
                    msg["content"] = None  # OpenAI requires the key
                messages.append(msg)

    return messages


async def _save_message(
    conversation_id: int, role: str, content: Any
) -> int:
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO chat_messages (conversation_id, role, content_json) VALUES (?, ?, ?)",
            (conversation_id, role, json.dumps(content)),
        )
        await db.execute(
            "UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?",
            (conversation_id,),
        )
        await db.commit()
        return cursor.lastrowid or 0
    finally:
        await db.close()


async def _get_session_id(conversation_id: int) -> Optional[str]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT session_id FROM chat_conversations WHERE id = ?", (conversation_id,)
        )
        row = await cursor.fetchone()
        return row["session_id"] if row else None
    finally:
        await db.close()


async def run_chat_turn(
    conversation_id: int, user_message: str
) -> AsyncIterator[str]:
    """Run one turn end-to-end, yielding SSE frames.

    Event types (see ChatStreamEvent in frontend api.ts):
        status       – lifecycle markers
        text_delta   – incremental assistant text
        tool_use     – about to run a tool
        tool_result  – tool finished
        message_complete – assistant turn persisted
        error        – fatal for this turn
    """
    session_id = await _get_session_id(conversation_id)
    if not session_id:
        yield _sse({"type": "error", "error": "Conversation not found"})
        return

    api_key = await _get_api_key()
    if not api_key:
        yield _sse({
            "type": "error",
            "error": (
                "No OpenRouter API key configured. Set OPENROUTER_API_KEY "
                "environment variable or add 'openrouter_api_key' in Settings → Integrations."
            ),
        })
        return

    try:
        from openai import AsyncOpenAI
    except ImportError:
        yield _sse({
            "type": "error",
            "error": "openai package not installed. Run: pip install openai",
        })
        return

    base_url = os.environ.get("OPENROUTER_BASE_URL", DEFAULT_BASE_URL)
    model = os.environ.get("STINT_LLM_MODEL", DEFAULT_MODEL)

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        default_headers={
            # Optional OpenRouter analytics headers — harmless if ignored.
            "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "http://localhost:3000"),
            "X-Title": "Stint",
        },
    )

    # Build message list: system + history + new user turn
    history = await _load_history(conversation_id)
    history.append({"role": "user", "content": user_message})
    await _save_message(conversation_id, "user", {"text": user_message})

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}] + history

    yield _sse({"type": "status", "status": "thinking"})

    assistant_final_text = ""
    assistant_final_tool_calls: list[dict] = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        # Accumulators for this LLM round
        text_buffer = ""
        tool_call_buffer: dict[int, dict] = {}  # index → {id, name, arguments_str}
        finish_reason: Optional[str] = None

        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOL_SCHEMAS,
                max_tokens=MAX_TOKENS,
                stream=True,
            )
        except Exception as e:
            yield _sse({"type": "error", "error": f"LLM call failed: {type(e).__name__}: {e}"})
            return

        try:
            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                # Text content
                text = getattr(delta, "content", None)
                if text:
                    text_buffer += text
                    yield _sse({"type": "text_delta", "delta": text})

                # Tool call fragments — arrive incrementally, must be concatenated
                tool_call_deltas = getattr(delta, "tool_calls", None)
                if tool_call_deltas:
                    for tcd in tool_call_deltas:
                        idx = getattr(tcd, "index", 0)
                        slot = tool_call_buffer.setdefault(
                            idx,
                            {"id": "", "name": "", "arguments_str": ""},
                        )
                        if getattr(tcd, "id", None):
                            slot["id"] = tcd.id
                        fn = getattr(tcd, "function", None)
                        if fn is not None:
                            if getattr(fn, "name", None):
                                slot["name"] = fn.name
                            if getattr(fn, "arguments", None):
                                slot["arguments_str"] += fn.arguments

                if choice.finish_reason:
                    finish_reason = choice.finish_reason
        except Exception as e:
            yield _sse({"type": "error", "error": f"Stream read failed: {type(e).__name__}: {e}"})
            return

        # Build the assistant message we just emitted
        parsed_tool_calls: list[dict] = []
        for idx in sorted(tool_call_buffer.keys()):
            slot = tool_call_buffer[idx]
            try:
                parsed_args = json.loads(slot["arguments_str"]) if slot["arguments_str"] else {}
            except Exception:
                parsed_args = {}
            parsed_tool_calls.append({
                "id": slot["id"],
                "type": "function",
                "function": {
                    "name": slot["name"],
                    "arguments": slot["arguments_str"] or "{}",
                },
                "_parsed_args": parsed_args,  # internal, stripped before sending
            })

        # Track final assistant output across iterations
        if text_buffer:
            assistant_final_text = (assistant_final_text + text_buffer) if assistant_final_text else text_buffer
        if parsed_tool_calls:
            assistant_final_tool_calls.extend(parsed_tool_calls)

        # Append assistant turn to messages (strip internal _parsed_args before sending)
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": text_buffer or None}
        if parsed_tool_calls:
            assistant_msg["tool_calls"] = [
                {k: v for k, v in tc.items() if not k.startswith("_")}
                for tc in parsed_tool_calls
            ]
        messages.append(assistant_msg)

        if finish_reason != "tool_calls" or not parsed_tool_calls:
            # Final answer — persist and finish
            persist_payload: dict[str, Any] = {}
            if assistant_final_text:
                persist_payload["text"] = assistant_final_text
            if assistant_final_tool_calls:
                persist_payload["tool_calls"] = [
                    {k: v for k, v in tc.items() if not k.startswith("_")}
                    for tc in assistant_final_tool_calls
                ]
            msg_id = await _save_message(conversation_id, "assistant", persist_payload)
            yield _sse({"type": "message_complete", "message_id": msg_id})
            yield _sse({"type": "status", "status": "complete"})
            return

        # Execute each tool call
        for tc in parsed_tool_calls:
            name = tc["function"]["name"]
            tc_id = tc["id"]
            tc_input = tc["_parsed_args"]

            yield _sse({
                "type": "tool_use",
                "tool_use_id": tc_id,
                "tool_name": name,
                "tool_input": tc_input,
            })

            result = await execute_tool(name, tc_input, session_id)
            try:
                result_text = json.dumps(result, default=str)
            except Exception:
                result_text = str(result)

            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": result_text,
            })

            yield _sse({
                "type": "tool_result",
                "tool_use_id": tc_id,
                "tool_name": name,
                "tool_output": result,
            })

    # Hit iteration cap
    yield _sse({"type": "status", "status": "max_iterations"})
    if assistant_final_text or assistant_final_tool_calls:
        persist_payload = {}
        if assistant_final_text:
            persist_payload["text"] = assistant_final_text
        if assistant_final_tool_calls:
            persist_payload["tool_calls"] = [
                {k: v for k, v in tc.items() if not k.startswith("_")}
                for tc in assistant_final_tool_calls
            ]
        msg_id = await _save_message(conversation_id, "assistant", persist_payload)
        yield _sse({"type": "message_complete", "message_id": msg_id})
    yield _sse({"type": "status", "status": "complete"})
