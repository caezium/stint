"""Bridge between libxrk and the storage layer (Arrow IPC cache + SQLite)."""

import hashlib
import json
import os
from io import BytesIO
from typing import Optional

import pyarrow as pa
import pyarrow.ipc as ipc
from libxrk import aim_xrk, ChannelMetadata

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
XRK_DIR = os.path.join(DATA_DIR, "xrk")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
METADATA_FILE = "session.json"

# Channel categorization
CHANNEL_CATEGORIES = {
    "Engine": ["RPM", "Gear", "TPS", "PPS", "Lambda", "MAP", "Baro", "ClutchSw", "StartRec"],
    "GPS": ["GPS", "Latitude", "Longitude", "Altitude", "Heading", "Satellites", "pDOP", "Fix"],
    "Speed": ["Speed", "WheelSpd"],
    "Temperature": ["Temp", "ECT", "OilTemp", "WT", "IntakeAir", "Ambient", "CAT1", "EGT", "LoggerTemp"],
    "Acceleration": ["Acc", "InlineAcc", "LateralAcc", "VerticalAcc", "Grip"],
    "Rotation": ["Roll", "Pitch", "Yaw"],
    "Brakes": ["Brake", "BRK"],
    "Suspension": ["Shock", "ACCEL", "Steer", "steering"],
    "Timing": ["Predictive", "Best Run", "Best Today", "Prev Lap", "Ref Lap"],
    "Voltage": ["Voltage", "ADC"],
}


def categorize_channel(name: str) -> str:
    for category, patterns in CHANNEL_CATEGORIES.items():
        for pattern in patterns:
            if pattern.lower() in name.lower():
                return category
    return "Other"


def generate_session_id(file_bytes: bytes, filename: str) -> str:
    """Generate a stable session ID from file content hash."""
    h = hashlib.sha256(file_bytes[:8192]).hexdigest()[:12]
    base = os.path.splitext(filename)[0].replace(" ", "_")[:40]
    return f"{base}_{h}"


def parse_and_cache(file_bytes: bytes, filename: str) -> dict:
    """
    Parse an XRK/XRZ file and cache Arrow IPC per channel.
    Returns metadata dict for database insertion.
    """
    session_id = generate_session_id(file_bytes, filename)
    cache_dir = os.path.join(CACHE_DIR, session_id)

    # Skip parsing if a complete cached session payload already exists.
    cached = _load_cached_metadata(cache_dir)
    if cached is not None:
        return cached

    # Parse with libxrk
    log = aim_xrk(BytesIO(file_bytes))
    meta = log.metadata

    # Save original file
    os.makedirs(XRK_DIR, exist_ok=True)
    original_ext = os.path.splitext(filename)[1] or ".xrk"
    xrk_path = os.path.join(XRK_DIR, f"{session_id}{original_ext.lower()}")
    if not os.path.exists(xrk_path):
        with open(xrk_path, "wb") as f:
            f.write(file_bytes)

    # Cache each channel as Arrow IPC
    os.makedirs(cache_dir, exist_ok=True)
    channels_meta = []

    for ch_name, ch_table in log.channels.items():
        # Save Arrow IPC
        safe_name = ch_name.replace("/", "_").replace(" ", "_")
        arrow_path = os.path.join(cache_dir, f"{safe_name}.arrow")
        with pa.OSFile(arrow_path, "wb") as f:
            writer = ipc.new_file(f, ch_table.schema)
            writer.write_table(ch_table)
            writer.close()

        # Extract metadata
        field = ch_table.schema.field(ch_name)
        try:
            cm = ChannelMetadata.from_field(field)
            channels_meta.append({
                "name": ch_name,
                "units": cm.units or "",
                "dec_pts": cm.dec_pts or 1,
                "sample_count": ch_table.num_rows,
                "interpolate": cm.interpolate if cm.interpolate is not None else True,
                "function_name": cm.function or "",
                "category": categorize_channel(ch_name),
            })
        except Exception:
            channels_meta.append({
                "name": ch_name,
                "units": "",
                "dec_pts": 1,
                "sample_count": ch_table.num_rows,
                "interpolate": True,
                "function_name": "",
                "category": categorize_channel(ch_name),
            })

    # Extract laps
    laps_data = []
    if log.laps and log.laps.num_rows > 0:
        for i in range(log.laps.num_rows):
            num = log.laps.column("num")[i].as_py()
            start = log.laps.column("start_time")[i].as_py()
            end = log.laps.column("end_time")[i].as_py()
            laps_data.append({
                "num": num,
                "start_time_ms": start,
                "end_time_ms": end,
                "duration_ms": end - start,
            })

    # Best lap (skip lap 0 = out-lap, skip last lap = in-lap)
    racing_laps = [l for l in laps_data if l["num"] > 0 and l["duration_ms"] > 0]
    best_lap_ms = min((l["duration_ms"] for l in racing_laps), default=0)
    total_ms = max((l["end_time_ms"] for l in laps_data), default=0)

    result = {
        "session_id": session_id,
        "file_name": filename,
        "driver": meta.get("Driver", ""),
        "vehicle": meta.get("Vehicle", ""),
        "venue": meta.get("Venue", ""),
        "log_date": meta.get("Log Date", ""),
        "log_time": meta.get("Log Time", ""),
        "session_name": meta.get("Session", ""),
        "series": meta.get("Series", ""),
        "logger_model": meta.get("Logger Model", ""),
        "logger_id": meta.get("Logger ID", 0),
        "lap_count": len(laps_data),
        "best_lap_time_ms": best_lap_ms,
        "total_duration_ms": total_ms,
        "channels": channels_meta,
        "laps": laps_data,
    }
    _write_cached_metadata(cache_dir, result)
    return result


def get_channel_arrow_path(session_id: str, channel_name: str) -> Optional[str]:
    """Get the Arrow IPC file path for a channel."""
    safe_name = channel_name.replace("/", "_").replace(" ", "_")
    path = os.path.join(CACHE_DIR, session_id, f"{safe_name}.arrow")
    if os.path.exists(path):
        return path
    # Try original name
    for fname in os.listdir(os.path.join(CACHE_DIR, session_id)):
        if fname.endswith(".arrow"):
            # Check if this matches by reading the schema
            return os.path.join(CACHE_DIR, session_id, fname)
    return None


def list_cached_channels(session_id: str) -> list[str]:
    """List all cached channel files for a session."""
    cache_dir = os.path.join(CACHE_DIR, session_id)
    if not os.path.exists(cache_dir):
        return []
    return [f.replace(".arrow", "").replace("_", " ") for f in os.listdir(cache_dir) if f.endswith(".arrow")]


def _metadata_path(cache_dir: str) -> str:
    return os.path.join(cache_dir, METADATA_FILE)


def _load_cached_metadata(cache_dir: str) -> Optional[dict]:
    """Load a complete cached session payload if present."""
    metadata_path = _metadata_path(cache_dir)
    if not os.path.exists(metadata_path):
        return None

    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _write_cached_metadata(cache_dir: str, payload: dict) -> None:
    """Persist full session metadata so re-uploads stay idempotent."""
    with open(_metadata_path(cache_dir), "w", encoding="utf-8") as f:
        json.dump(payload, f)


def _find_xrk_file(session_id: str) -> Optional[str]:
    """Find the original XRK/XRZ file for a session."""
    for ext in (".xrk", ".xrz"):
        path = os.path.join(XRK_DIR, f"{session_id}{ext}")
        if os.path.exists(path):
            return path
    return None


def get_resampled_lap_data(
    session_id: str,
    channel_names: list[str],
    lap_num: int,
    ref_channel: Optional[str] = None,
) -> Optional[pa.Table]:
    """
    Load the original XRK, filter to a lap, resample all requested channels
    to a common timebase, and return a single dense Arrow table.

    Uses libxrk's resample_to_channel() which performs proper interpolation
    (linear for continuous channels, forward-fill for discrete).
    """
    # Check for cached resampled file
    ch_hash = hashlib.md5(",".join(sorted(channel_names)).encode()).hexdigest()[:8]
    ref = (ref_channel or "auto").replace(" ", "_")
    cache_key = f"resampled_L{lap_num}_{ref}_{ch_hash}.arrow"
    cache_path = os.path.join(CACHE_DIR, session_id, cache_key)

    if os.path.exists(cache_path):
        reader = ipc.open_file(cache_path)
        return reader.read_all()

    xrk_path = _find_xrk_file(session_id)
    if not xrk_path:
        return None

    with open(xrk_path, "rb") as f:
        log = aim_xrk(BytesIO(f.read()))

    # Filter to lap, select channels, resample
    lap_log = log.filter_by_lap(lap_num)

    # Find available channels (some requested names may not exist)
    available = set(lap_log.channels.keys())
    valid_channels = [ch for ch in channel_names if ch in available]
    if not valid_channels:
        return None

    selected = lap_log.select_channels(valid_channels)

    # Pick a reference channel for resampling (highest sample rate by default)
    if ref_channel and ref_channel in available:
        resampled = selected.resample_to_channel(ref_channel)
    else:
        # Use the channel with the most samples as reference
        best_ref = max(valid_channels, key=lambda c: selected.channels[c].num_rows)
        resampled = selected.resample_to_channel(best_ref)

    merged = resampled.get_channels_as_table()

    # Cache the result
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with pa.OSFile(cache_path, "wb") as f:
        writer = ipc.new_file(f, merged.schema)
        writer.write_table(merged)
        writer.close()

    return merged
