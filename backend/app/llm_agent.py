"""
LLM agent: streaming chat loop emitting the Vercel AI SDK v5 UI message stream.

Architecture:
    user → run_chat_turn() yields SSE-framed UI message stream events
        → OpenRouter chat.completions.create(stream=True, tools=...)
        → on tool_calls: accumulate, run execute_tool(), feed back as role=tool
        → loop until finish_reason != "tool_calls"
    Conversation + UIMessage[] persisted to chat_messages.content_json.

Wire format (AI SDK v5):
    Each line is `data: {json}\n\n` (SSE). The stream begins with `start`,
    contains nested `start-step` blocks, each holding `text-*`, `tool-input-*`,
    and `tool-output-*` events, and ends with `finish-step` then `finish`.

Default model resolved through llm_client.get_default_model() — env var
STINT_LLM_MODEL, then user_settings.stint_llm_model, then sonnet-4.5.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncIterator, Optional

from .database import get_db
from .llm_client import get_default_model, make_client
from .llm_tools import TOOL_SCHEMAS, execute_tool, summarize_tool_result


MAX_TOOL_ITERATIONS = 8
MAX_TOKENS = 2048

SYSTEM_PROMPT = """You are Stint, a racing telemetry coach for karters and amateur racers. You help them go faster, understand their car, and fix bad habits.

═══════════════════════════════════════════════════════════════════════════
YOUR JOB IS TO INFER INTENT, NOT EXECUTE LITERAL COMMANDS.

Drivers will describe problems in plain English ("I feel slow in T3", "the
car won't turn in", "where am I losing time", "show me when I'm breaking
traction"). You decide which tools to call and which math channels/layouts
would illuminate the answer. Never ask the user which tool to use.

═══════════════════════════════════════════════════════════════════════════

HOW TO THINK

1. DIAGNOSE FIRST, then PRESCRIBE. Never stop at stats.
   ❌ "Your throttle COV is 7%."
   ✅ "You're stabbing the throttle out of T3 — lifts at 42%, 58%, 71% of
       the corner exit. Try holding steady part-throttle through apex, then
       rolling in after the car is straight."

2. When the driver asks "where am I losing time" / "help me be faster" /
   "what should I work on":
      • `get_coaching_points` (braking distance, apex speed, throttle pickup
        deltas vs per-sector best) is the single highest-leverage tool.
      • Back it up with `compare_laps_delta` between the worst relevant lap
        and the best lap.
      • If appropriate, PROPOSE a compare layout via `apply_layout` that
        shows Speed + Brake + Throttle for the relevant laps so they can
        see the gap visually. Don't ask permission — surface the card.

3. When the driver describes a handling issue ("car pushes wide", "snappy
   on entry", "no front grip", "oversteer out of slow corners"):
      • Call `get_anomalies` and check for `understeer` / `oversteer` /
        `traction_loss` findings.
      • If there's a relevant channel, PROPOSE a math channel via
        `apply_math_channel` that makes the issue visible. Examples:
          – Front grip: `clip(WheelSpeedF - GPS_Speed, 0, 100)` (wheelspin)
          – Lateral load: `abs(GPS_LateralAcc)` (peak cornering force)
          – Brake balance: `BrakePressF / (BrakePressF + BrakePressR)` when
            both channels are present
          – Throttle aggression: `diff(TPS)`
        Tell them what the channel reveals.

4. When the driver asks about consistency, session arc, or fatigue:
      • `get_fingerprint_evolution` shows per-lap smoothness trends.
      • `get_debrief` has COV and sector stddev.

5. When the driver compares to history ("am I faster than last time",
   "vs my PB here"):
      • `find_similar_sessions` → pick a candidate → `compare_sessions`.
      • For sector PBs: `personal_best_sector`.

6. Start vague openers with `get_session_overview` + `get_debrief` to
   orient yourself before answering.

═══════════════════════════════════════════════════════════════════════════

TWO-STEP WRITE TOOLS (`apply_layout`, `apply_math_channel`)

These store a PROPOSAL. The frontend shows the user an Apply button. The
user clicks Apply if they want it. Your job is to pick good proposals and
say "I've proposed [X] — click Apply in the chat to add it". Do NOT ask
"would you like me to add a math channel?" — just propose it and explain.

When to reach for them, unprompted:
  • Driver asks a question whose answer is clearer with a specific layout
    or math channel.
  • Driver describes a symptom ("tires grain after 5 laps") that maps to a
    diagnostic channel they don't currently have.

═══════════════════════════════════════════════════════════════════════════

STYLE

• Markdown: bullets for comparisons, **bold** for the headline number,
  tables for sector splits, inline math ($\\Delta t$) where useful.
• Lap times in mm:ss.SSS. Distances in m. Speeds in km/h.
• Always cite lap number + where in the lap (distance %, sector, channel).
• CITATION LINKS: when you reference a specific point in a lap, make the
  citation a clickable markdown link using the `stint://` scheme so the
  user can jump straight to it in the analysis workspace:
      [L5 · 45%](stint://lap/5?pct=45)
      [lap 3 at 78%](stint://lap/3?pct=78)
      [L7](stint://lap/7)           ← whole lap, no distance
  The UI renders these inline as jump-to-analysis links. Use them every
  time you cite a lap; do NOT use `stint://` for anything else.
• Concise: 1-3 short paragraphs ideal. Bullet lists welcome.
• Never fabricate numbers. If a tool result doesn't back the claim, run
  another tool or say you don't know.

═══════════════════════════════════════════════════════════════════════════

CONTEXT-AWARE

The USER CONTEXT preamble tells you what the user is currently looking at
in the workspace (lap, distance, visible channels). Anchor your answer
there unless they explicitly ask about something else.
"""


# ---------------------------------------------------------------------------
# AI SDK v5 UI message stream helpers
# ---------------------------------------------------------------------------

# https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
UI_MESSAGE_STREAM_HEADERS = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "x-vercel-ai-ui-message-stream": "v1",
}


def _frame(event: dict) -> str:
    """Encode one UI message stream chunk as an SSE data line."""
    return f"data: {json.dumps(event)}\n\n"


def _event_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Persistence (UIMessage shape — list of typed parts)
# ---------------------------------------------------------------------------


async def _load_history_openai(conversation_id: int) -> list[dict]:
    """Reconstruct the OpenAI-format message history from stored UIMessages.

    We persist messages in AI-SDK UIMessage shape ({id, role, parts:[...]}); to
    feed them back into the OpenAI-compatible chat completions API we have to
    flatten parts into text/content + assistant tool_calls + role=tool replies.
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

        # Modern UIMessage shape: {id, role, parts: [...]}
        if isinstance(content, dict) and isinstance(content.get("parts"), list):
            parts = content["parts"]
            role = r["role"]

            if role == "user":
                text = "\n".join(
                    p.get("text", "") for p in parts if p.get("type") == "text"
                ).strip()
                if text:
                    messages.append({"role": "user", "content": text})

            elif role == "assistant":
                # text parts → content; tool-call parts → tool_calls
                text = "\n".join(
                    p.get("text", "") for p in parts if p.get("type") == "text"
                ).strip()
                tool_calls: list[dict] = []
                for p in parts:
                    t = p.get("type", "")
                    if t.startswith("tool-") and "toolCallId" in p:
                        # collapse the various tool-* parts to a single OpenAI call
                        if any(tc["id"] == p["toolCallId"] for tc in tool_calls):
                            continue
                        tool_calls.append({
                            "id": p["toolCallId"],
                            "type": "function",
                            "function": {
                                "name": p.get("toolName", ""),
                                "arguments": json.dumps(p.get("input", {})),
                            },
                        })
                msg: dict[str, Any] = {"role": "assistant", "content": text or None}
                if tool_calls:
                    msg["tool_calls"] = tool_calls
                messages.append(msg)
                # tool-output parts replay as role=tool messages
                for p in parts:
                    if p.get("type", "").startswith("tool-") and "output" in p:
                        try:
                            output_text = json.dumps(p["output"], default=str)
                        except Exception:
                            output_text = str(p["output"])
                        messages.append({
                            "role": "tool",
                            "tool_call_id": p["toolCallId"],
                            "content": output_text,
                        })
            continue

        # ---- Legacy fallback shapes (pre-Phase-0 conversations) ----

        if r["role"] == "user":
            if isinstance(content, dict) and "text" in content:
                messages.append({"role": "user", "content": content["text"]})
            elif isinstance(content, str):
                messages.append({"role": "user", "content": content})

        elif r["role"] == "assistant":
            if isinstance(content, dict):
                msg = {"role": "assistant"}
                if content.get("text"):
                    msg["content"] = content["text"]
                if content.get("tool_calls"):
                    msg["tool_calls"] = content["tool_calls"]
                if "content" not in msg:
                    msg["content"] = None
                messages.append(msg)

    return messages


async def _save_uimessage(
    conversation_id: int,
    role: str,
    parts: list[dict],
    *,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
    model: Optional[str] = None,
) -> int:
    """Persist a message in UIMessage format. Returns the new row id."""
    payload = {
        "id": _event_id("msg"),
        "role": role,
        "parts": parts,
    }
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO chat_messages "
            "(conversation_id, role, content_json, tokens_in, tokens_out, model) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (conversation_id, role, json.dumps(payload), tokens_in, tokens_out, model),
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
            "SELECT session_id FROM chat_conversations WHERE id = ?",
            (conversation_id,),
        )
        row = await cursor.fetchone()
        return row["session_id"] if row else None
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Main streaming loop
# ---------------------------------------------------------------------------


def _context_preamble(chat_context: Optional[dict]) -> str:
    """Render the optional analysis-workspace context into a preamble line."""
    if not chat_context:
        return ""
    bits: list[str] = []
    if chat_context.get("pinned_lap") is not None:
        bits.append(f"lap {chat_context['pinned_lap']}")
    if chat_context.get("pinned_distance_m") is not None:
        bits.append(f"distance {chat_context['pinned_distance_m']:.0f} m")
    if chat_context.get("visible_channels"):
        chs = ", ".join(chat_context["visible_channels"][:6])
        bits.append(f"channels: {chs}")
    if chat_context.get("zoom_range"):
        zr = chat_context["zoom_range"]
        bits.append(f"zoom {zr[0]}\u2013{zr[1]}")
    if not bits:
        return ""
    return f"\n\nUSER CONTEXT — they are currently looking at: {' · '.join(bits)}."


async def run_chat_turn(
    conversation_id: int,
    user_message: str,
    *,
    chat_context: Optional[dict] = None,
    is_disconnected=None,
) -> AsyncIterator[str]:
    """Run one turn end-to-end, yielding AI SDK v5 UI-message-stream frames.

    is_disconnected: optional async callable (e.g. request.is_disconnected) — if
    provided we poll between chunks and abort the upstream call when the client
    goes away.
    """
    session_id = await _get_session_id(conversation_id)
    if not session_id:
        yield _frame({"type": "error", "errorText": "Conversation not found"})
        return

    client = await make_client()
    if client is None:
        yield _frame({
            "type": "error",
            "errorText": (
                "No OpenRouter API key configured. Set OPENROUTER_API_KEY or "
                "add 'openrouter_api_key' in Settings → Integrations."
            ),
        })
        return

    model = await get_default_model()

    # Persist the incoming user turn as a UIMessage
    await _save_uimessage(
        conversation_id, "user", [{"type": "text", "text": user_message}]
    )

    history = await _load_history_openai(conversation_id)
    system_content = SYSTEM_PROMPT + _context_preamble(chat_context)
    messages: list[dict] = [{"role": "system", "content": system_content}] + history

    # ---- Stream lifecycle: start ----
    yield _frame({"type": "start"})

    assistant_parts: list[dict] = []
    total_in = 0
    total_out = 0

    try:
        for iteration in range(MAX_TOOL_ITERATIONS):
            # Hang up early if client disconnected
            if is_disconnected is not None:
                try:
                    if await is_disconnected():
                        return
                except Exception:
                    pass

            yield _frame({"type": "start-step"})

            text_id = _event_id("text")
            text_buffer = ""
            text_started = False
            tool_call_buffer: dict[int, dict] = {}
            finish_reason: Optional[str] = None
            tool_input_started: dict[int, bool] = {}
            usage: dict[str, Any] = {}

            try:
                stream = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                    max_tokens=MAX_TOKENS,
                    stream=True,
                    stream_options={"include_usage": True},
                )
            except Exception as e:
                yield _frame({
                    "type": "error",
                    "errorText": f"LLM call failed: {type(e).__name__}: {e}",
                })
                return

            try:
                async for chunk in stream:
                    if is_disconnected is not None:
                        try:
                            if await is_disconnected():
                                # Best-effort cancel of the upstream async iterator
                                try:
                                    await stream.aclose()
                                except Exception:
                                    pass
                                return
                        except Exception:
                            pass

                    # Usage is sent in the final chunk (with empty choices)
                    chunk_usage = getattr(chunk, "usage", None)
                    if chunk_usage:
                        usage = {
                            "input_tokens": getattr(chunk_usage, "prompt_tokens", 0) or 0,
                            "output_tokens": getattr(chunk_usage, "completion_tokens", 0) or 0,
                        }
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta = choice.delta

                    text = getattr(delta, "content", None)
                    if text:
                        if not text_started:
                            yield _frame({"type": "text-start", "id": text_id})
                            text_started = True
                        text_buffer += text
                        yield _frame({
                            "type": "text-delta",
                            "id": text_id,
                            "delta": text,
                        })

                    tool_call_deltas = getattr(delta, "tool_calls", None)
                    if tool_call_deltas:
                        for tcd in tool_call_deltas:
                            idx = getattr(tcd, "index", 0)
                            slot = tool_call_buffer.setdefault(
                                idx, {"id": "", "name": "", "arguments_str": ""}
                            )
                            if getattr(tcd, "id", None):
                                slot["id"] = tcd.id
                            fn = getattr(tcd, "function", None)
                            if fn is not None:
                                if getattr(fn, "name", None):
                                    slot["name"] = fn.name
                                if getattr(fn, "arguments", None):
                                    slot["arguments_str"] += fn.arguments
                                    # Emit input-start once we know the tool name+id
                                    if (
                                        slot["id"]
                                        and slot["name"]
                                        and not tool_input_started.get(idx)
                                    ):
                                        yield _frame({
                                            "type": "tool-input-start",
                                            "toolCallId": slot["id"],
                                            "toolName": slot["name"],
                                        })
                                        tool_input_started[idx] = True
                                    if tool_input_started.get(idx):
                                        yield _frame({
                                            "type": "tool-input-delta",
                                            "toolCallId": slot["id"],
                                            "inputTextDelta": fn.arguments,
                                        })

                    if choice.finish_reason:
                        finish_reason = choice.finish_reason
            except Exception as e:
                yield _frame({
                    "type": "error",
                    "errorText": f"Stream read failed: {type(e).__name__}: {e}",
                })
                return

            if text_started:
                yield _frame({"type": "text-end", "id": text_id})

            # Track token totals across iterations
            total_in += int(usage.get("input_tokens") or 0)
            total_out += int(usage.get("output_tokens") or 0)

            # Build the OpenAI-format assistant message we just produced for the
            # next iteration
            parsed_tool_calls: list[dict] = []
            for idx in sorted(tool_call_buffer.keys()):
                slot = tool_call_buffer[idx]
                try:
                    parsed_args = (
                        json.loads(slot["arguments_str"]) if slot["arguments_str"] else {}
                    )
                except Exception:
                    parsed_args = {}
                parsed_tool_calls.append({
                    "id": slot["id"],
                    "name": slot["name"],
                    "input": parsed_args,
                })

            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": text_buffer or None,
            }
            if parsed_tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["input"]),
                        },
                    }
                    for tc in parsed_tool_calls
                ]
            messages.append(assistant_msg)

            # Persist parts produced by this step
            if text_buffer:
                assistant_parts.append({"type": "text", "text": text_buffer})

            # Last step? Emit finish-step + finish, persist, return
            if finish_reason != "tool_calls" or not parsed_tool_calls:
                yield _frame({"type": "finish-step"})
                yield _frame({
                    "type": "finish",
                    "messageMetadata": {
                        "model": model,
                        "tokensIn": total_in,
                        "tokensOut": total_out,
                    },
                })
                msg_id = await _save_uimessage(
                    conversation_id,
                    "assistant",
                    assistant_parts or [{"type": "text", "text": ""}],
                    tokens_in=total_in,
                    tokens_out=total_out,
                    model=model,
                )
                yield _frame({
                    "type": "data-message-id",
                    "data": {"messageId": str(msg_id)},
                    "transient": True,
                })
                return

            # Execute each tool call, emit input-available + output-available,
            # and feed results back into the chat loop
            for tc in parsed_tool_calls:
                yield _frame({
                    "type": "tool-input-available",
                    "toolCallId": tc["id"],
                    "toolName": tc["name"],
                    "input": tc["input"],
                })
                assistant_parts.append({
                    "type": f"tool-{tc['name']}",
                    "toolCallId": tc["id"],
                    "toolName": tc["name"],
                    "state": "input-available",
                    "input": tc["input"],
                })

                if is_disconnected is not None:
                    try:
                        if await is_disconnected():
                            return
                    except Exception:
                        pass

                result = await execute_tool(tc["name"], tc["input"], session_id)
                summary = summarize_tool_result(tc["name"], tc["input"], result)

                try:
                    result_text = json.dumps(result, default=str)
                except Exception:
                    result_text = str(result)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_text,
                })

                yield _frame({
                    "type": "tool-output-available",
                    "toolCallId": tc["id"],
                    "output": result,
                })
                if summary:
                    # Side-channel summary for the collapsed chip (T1.4)
                    yield _frame({
                        "type": "data-tool-summary",
                        "id": tc["id"],
                        "data": {"toolCallId": tc["id"], "summary": summary},
                        "transient": True,
                    })
                # Update the last matching part to carry the output
                for p in assistant_parts:
                    if (
                        p.get("toolCallId") == tc["id"]
                        and p.get("type", "").startswith("tool-")
                    ):
                        p["state"] = "output-available"
                        p["output"] = result
                        if summary:
                            p["summary"] = summary
                        break

            yield _frame({"type": "finish-step"})

        # Iteration cap
        yield _frame({
            "type": "error",
            "errorText": f"Reached max iterations ({MAX_TOOL_ITERATIONS}) without resolution.",
        })
        if assistant_parts:
            await _save_uimessage(
                conversation_id,
                "assistant",
                assistant_parts,
                tokens_in=total_in,
                tokens_out=total_out,
                model=model,
            )
        yield _frame({"type": "finish"})

    finally:
        try:
            await client.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Conversation auto-titling (T3.8) — exposed for chat router to fire after the
# first turn completes.
# ---------------------------------------------------------------------------


async def maybe_autotitle_conversation(conversation_id: int, first_user_msg: str) -> None:
    """If conversation title is empty / placeholder, ask Haiku for a 4-word title.

    Best-effort — silently swallows errors.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT title FROM chat_conversations WHERE id = ?", (conversation_id,)
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row:
        return
    current = (row["title"] or "").strip()
    # If the title is anything other than empty / the slice(0,40) default that
    # equals the start of the user message, leave it alone.
    if current and current != first_user_msg.strip()[:40]:
        return

    client = await make_client()
    if client is None:
        return
    try:
        from .llm_client import FAST_MODEL
        resp = await client.chat.completions.create(
            model=FAST_MODEL,
            max_tokens=24,
            messages=[
                {
                    "role": "system",
                    "content": "Reply with a 3- or 4-word title. No quotes. No punctuation.",
                },
                {
                    "role": "user",
                    "content": f"Name this chat. The user asked: {first_user_msg[:300]}",
                },
            ],
        )
        title = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
        title = " ".join(title.split())[:60]
        if not title:
            return
        db = await get_db()
        try:
            await db.execute(
                "UPDATE chat_conversations SET title = ? WHERE id = ?",
                (title, conversation_id),
            )
            await db.commit()
        finally:
            await db.close()
    except Exception:
        pass
    finally:
        try:
            await client.close()
        except Exception:
            pass
