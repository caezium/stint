"""Shared channel helpers used across anomalies, debrief, coaching, and tools.

Promoted from inline duplicates in anomalies.py / debrief.py / llm_tools.py.
"""

from __future__ import annotations

import os
from typing import Optional

import numpy as np
import pyarrow.ipc as ipc

from .xrk_service import CACHE_DIR


def list_channels(session_id: str) -> list[str]:
    """Channel names available in the per-session arrow cache."""
    cache_dir = os.path.join(CACHE_DIR, session_id)
    if not os.path.exists(cache_dir):
        return []
    out: list[str] = []
    for fname in os.listdir(cache_dir):
        if not fname.endswith(".arrow"):
            continue
        if fname.startswith("resampled_"):
            continue
        out.append(fname[: -len(".arrow")].replace("_", " "))
    return out


def find_arrow_file(session_id: str, channel_name: str) -> Optional[str]:
    cache_dir = os.path.join(CACHE_DIR, session_id)
    if not os.path.exists(cache_dir):
        return None
    safe = channel_name.replace("/", "_").replace(" ", "_")
    direct = os.path.join(cache_dir, f"{safe}.arrow")
    if os.path.exists(direct):
        return direct
    for fname in os.listdir(cache_dir):
        if fname.lower() == f"{safe.lower()}.arrow":
            return os.path.join(cache_dir, fname)
    return None


def match_channel(channels: list[str], needles: list[str]) -> Optional[str]:
    """Return the first channel whose name contains any needle (case-insensitive)."""
    low = {c.lower(): c for c in channels}
    for needle in needles:
        n = needle.lower()
        for lk, orig in low.items():
            if n in lk:
                return orig
    return None


def read_channel(session_id: str, channel: str) -> Optional[np.ndarray]:
    path = find_arrow_file(session_id, channel)
    if not path:
        return None
    try:
        table = ipc.open_file(path).read_all()
        values = table.column(table.num_columns - 1).to_numpy(zero_copy_only=False)
        return values.astype(np.float64)
    except Exception:
        return None


def read_channel_with_time(
    session_id: str, channel: str
) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Return (timestamps_ms, values) for a channel, or None."""
    path = find_arrow_file(session_id, channel)
    if not path:
        return None
    try:
        table = ipc.open_file(path).read_all()
        ts = table.column(0).to_numpy(zero_copy_only=False).astype(np.float64)
        val = table.column(table.num_columns - 1).to_numpy(zero_copy_only=False).astype(np.float64)
        return ts, val
    except Exception:
        return None


def haversine_cumdist(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Cumulative distance (meters) along a GPS track using the haversine formula."""
    R = 6371000.0
    if len(lats) < 2:
        return np.zeros(len(lats))
    dlat = np.diff(np.radians(lats))
    dlon = np.diff(np.radians(lons))
    lat1 = np.radians(lats[:-1])
    lat2 = np.radians(lats[1:])
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
    seg = R * c
    return np.concatenate([[0.0], np.cumsum(seg)])


def lap_pct_for_timestamp(
    laps: list[dict], ts_ms: float
) -> tuple[Optional[int], Optional[float], Optional[int]]:
    """Map an absolute timestamp (ms) to (lap_num, lap_pct, time_in_lap_ms).

    Returns (None, None, None) if no lap contains the timestamp.
    """
    for lap in laps:
        start = lap.get("start_time_ms") or 0
        end = lap.get("end_time_ms") or 0
        dur = lap.get("duration_ms") or 0
        if start <= ts_ms <= end and dur > 0:
            in_lap = max(0, ts_ms - start)
            pct = max(0.0, min(100.0, (in_lap / dur) * 100.0))
            return int(lap.get("num", 0)), round(pct, 1), int(in_lap)
    return None, None, None
