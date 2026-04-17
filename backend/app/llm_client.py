"""
Shared LLM client (OpenRouter via OpenAI SDK).

Centralizes API key resolution + client construction so the chat agent,
debrief narrative generator, and conversation titler all share the same
configuration path.
"""

from __future__ import annotations

import os
from typing import Optional

from .database import get_db


DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"
# Haiku 4.6 doesn't exist yet on OpenRouter; 4.5 is the latest fast model.
FAST_MODEL = "anthropic/claude-haiku-4.5"
HEAVY_MODEL = "anthropic/claude-opus-4.7"
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


async def get_api_key() -> Optional[str]:
    """OpenRouter key. Priority: OPENROUTER_API_KEY env -> user_settings."""
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            ("openrouter_api_key",),
        )
        row = await cursor.fetchone()
        return (row["value"] or "").strip() if row else None
    finally:
        await db.close()


async def get_default_model() -> str:
    """Model id for general chat. user_settings override > env > built-in."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            ("stint_llm_model",),
        )
        row = await cursor.fetchone()
        if row and (row["value"] or "").strip():
            return row["value"].strip()
    finally:
        await db.close()
    return os.environ.get("STINT_LLM_MODEL", DEFAULT_MODEL)


def get_base_url() -> str:
    return os.environ.get("OPENROUTER_BASE_URL", DEFAULT_BASE_URL)


async def make_client():
    """Build an AsyncOpenAI client pointed at OpenRouter. Returns None if no key."""
    try:
        from openai import AsyncOpenAI
    except ImportError as e:
        raise RuntimeError(
            "openai package not installed. Run: pip install openai"
        ) from e

    key = await get_api_key()
    if not key:
        return None

    return AsyncOpenAI(
        api_key=key,
        base_url=get_base_url(),
        default_headers={
            "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "http://localhost:3000"),
            "X-Title": "Stint",
        },
    )
