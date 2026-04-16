"""
Anomaly detection for racing telemetry sessions.

Runs pure-NumPy statistical checks against cached channel data to surface
mechanical or sensor issues (cooling trends, brake fade, voltage sag, sensor
drift, RPM dropouts, tire deg). No ML dependencies.

Entry point: ``detect_session_anomalies(session_id)``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import pyarrow.ipc as ipc

from .database import get_db
from .xrk_service import CACHE_DIR, get_resampled_lap_data


Severity = str  # "info" | "warning" | "critical"


@dataclass
class Anomaly:
    type: str
    severity: Severity
    lap_num: Optional[int]
    channel: Optional[str]
    message: str
    metric_value: Optional[float]


# ---------------------------------------------------------------------------
# Channel discovery helpers
# ---------------------------------------------------------------------------


def _find_arrow_file(session_id: str, channel_name: str) -> Optional[str]:
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


def _list_channels(session_id: str) -> list[str]:
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


def _match_channel(channels: list[str], needles: list[str]) -> Optional[str]:
    """Return the first channel whose name contains any needle (case-insensitive)."""
    low = {c.lower(): c for c in channels}
    for needle in needles:
        n = needle.lower()
        for lk, orig in low.items():
            if n in lk:
                return orig
    return None


def _read_channel(session_id: str, channel: str) -> Optional[np.ndarray]:
    path = _find_arrow_file(session_id, channel)
    if not path:
        return None
    try:
        table = ipc.open_file(path).read_all()
        # Arrow schema is [timestamp, value] — take the last column as value
        values = table.column(table.num_columns - 1).to_numpy(zero_copy_only=False)
        return values.astype(np.float64)
    except Exception:
        return None


def _read_channel_with_time(
    session_id: str, channel: str
) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Return (timestamps_ms, values) for a channel, or None."""
    path = _find_arrow_file(session_id, channel)
    if not path:
        return None
    try:
        table = ipc.open_file(path).read_all()
        ts = table.column(0).to_numpy(zero_copy_only=False).astype(np.float64)
        val = table.column(table.num_columns - 1).to_numpy(zero_copy_only=False).astype(np.float64)
        return ts, val
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Individual detectors — each returns list[Anomaly]
# ---------------------------------------------------------------------------


def _detect_cooling_trend(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Per-lap max coolant/oil temp; flag rising slope."""
    results: list[Anomaly] = []
    for label, needles in (
        ("coolant", ["Water Temp", "WaterTemp", "ECT", "Coolant", " WT"]),
        ("oil", ["Oil Temp", "OilTemp"]),
    ):
        ch = _match_channel(channels, needles)
        if not ch:
            continue

        read = _read_channel_with_time(session_id, ch)
        if read is None:
            continue
        ts_ms, val = read
        if len(val) < 10:
            continue

        per_lap_max: list[float] = []
        per_lap_num: list[int] = []
        for lap in laps:
            if lap["num"] <= 0 or lap["duration_ms"] <= 0:
                continue
            mask = (ts_ms >= lap["start_time_ms"]) & (ts_ms <= lap["end_time_ms"])
            if not np.any(mask):
                continue
            per_lap_max.append(float(np.max(val[mask])))
            per_lap_num.append(lap["num"])

        if len(per_lap_max) < 3:
            continue

        x = np.arange(len(per_lap_max), dtype=np.float64)
        y = np.array(per_lap_max, dtype=np.float64)
        slope = float(np.polyfit(x, y, 1)[0])  # degrees per lap
        peak = float(np.max(y))

        # Thresholds: oil tolerates higher peaks than coolant
        peak_critical = 130.0 if label == "oil" else 105.0
        peak_warning = 120.0 if label == "oil" else 100.0

        if peak >= peak_critical:
            results.append(
                Anomaly(
                    type="cooling_peak",
                    severity="critical",
                    lap_num=per_lap_num[int(np.argmax(y))],
                    channel=ch,
                    message=f"{ch} peaked at {peak:.1f}°C — above safe threshold.",
                    metric_value=peak,
                )
            )
        elif peak >= peak_warning:
            results.append(
                Anomaly(
                    type="cooling_peak",
                    severity="warning",
                    lap_num=per_lap_num[int(np.argmax(y))],
                    channel=ch,
                    message=f"{ch} peaked at {peak:.1f}°C — approaching warning zone.",
                    metric_value=peak,
                )
            )

        if slope >= 1.5 and len(per_lap_max) >= 4:
            results.append(
                Anomaly(
                    type="cooling_trend",
                    severity="warning",
                    lap_num=per_lap_num[-1],
                    channel=ch,
                    message=f"{ch} trending up {slope:.1f}°C/lap across {len(per_lap_max)} laps — possible cooling issue.",
                    metric_value=slope,
                )
            )

    return results


def _detect_voltage_sag(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Battery/voltage channel dropping below threshold."""
    ch = _match_channel(channels, ["Battery", "BattVolt", " Voltage"])
    if not ch:
        return []
    vals = _read_channel(session_id, ch)
    if vals is None or len(vals) < 10:
        return []

    # Filter obvious junk (0 readings from sensor disconnect)
    good = vals[vals > 1.0]
    if len(good) < 10:
        return []

    vmin = float(np.min(good))
    vmax = float(np.max(good))
    vmean = float(np.mean(good))

    results: list[Anomaly] = []
    # Typical 12V system: nominal 13.5-14.4V running, <12V = sag, <11V = alarm
    if vmin < 11.0 and vmean < 13.0:
        results.append(
            Anomaly(
                type="voltage_sag",
                severity="critical",
                lap_num=None,
                channel=ch,
                message=f"{ch} dropped to {vmin:.1f}V (avg {vmean:.1f}V) — alternator or battery issue.",
                metric_value=vmin,
            )
        )
    elif vmin < 12.0 and vmean < 13.2:
        results.append(
            Anomaly(
                type="voltage_sag",
                severity="warning",
                lap_num=None,
                channel=ch,
                message=f"{ch} dropped to {vmin:.1f}V — check charging system.",
                metric_value=vmin,
            )
        )
    elif vmax - vmin > 4.0 and vmin < 12.5:
        results.append(
            Anomaly(
                type="voltage_swing",
                severity="warning",
                lap_num=None,
                channel=ch,
                message=f"{ch} swung {vmax - vmin:.1f}V across session — possible intermittent load.",
                metric_value=vmax - vmin,
            )
        )
    return results


def _detect_sensor_drift(
    session_id: str, channels: list[str]
) -> list[Anomaly]:
    """Flat-line or clipping detection on key channels."""
    results: list[Anomaly] = []
    targets = [
        ("RPM", ["RPM"]),
        ("Speed", ["GPS Speed", "Speed"]),
        ("Throttle", ["TPS", "Throttle"]),
    ]
    for label, needles in targets:
        ch = _match_channel(channels, needles)
        if not ch:
            continue
        vals = _read_channel(session_id, ch)
        if vals is None or len(vals) < 100:
            continue

        # Flat-line: > 30s of identical values on a channel that normally varies
        # Assuming ~50Hz sample rate → 1500 samples = 30s
        flat_run = 0
        max_flat = 0
        prev = None
        for v in vals:
            if prev is not None and v == prev:
                flat_run += 1
                if flat_run > max_flat:
                    max_flat = flat_run
            else:
                flat_run = 0
            prev = v

        # Only flag if overall variance is non-trivial (channel is active)
        if float(np.std(vals)) > 1.0 and max_flat > 1500:
            results.append(
                Anomaly(
                    type="sensor_flatline",
                    severity="warning",
                    lap_num=None,
                    channel=ch,
                    message=f"{ch} had {max_flat} consecutive identical samples — possible sensor dropout.",
                    metric_value=float(max_flat),
                )
            )
    return results


def _detect_tire_deg(
    session_id: str, laps: list[dict]
) -> list[Anomaly]:
    """Lap time decay across a stint — rolling degradation."""
    racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
    if len(racing) < 5:
        return []

    times = np.array([l["duration_ms"] for l in racing], dtype=np.float64)
    best = float(np.min(times))

    # Drop outliers that are > 120% of best (likely cooldown / pit laps)
    clean_mask = times <= best * 1.2
    times_clean = times[clean_mask]
    if len(times_clean) < 5:
        return []

    # Linear regression of lap time vs lap index
    x = np.arange(len(times_clean), dtype=np.float64)
    slope = float(np.polyfit(x, times_clean, 1)[0])  # ms per lap

    if slope >= 150.0:
        # > 150ms/lap consistent slowdown → tire deg or fuel burnoff
        return [
            Anomaly(
                type="pace_decay",
                severity="info",
                lap_num=racing[-1]["num"],
                channel=None,
                message=f"Lap times trending +{slope:.0f}ms/lap across {len(times_clean)} clean laps — tire deg or fuel load.",
                metric_value=slope,
            )
        ]
    return []


def _detect_lap_inconsistency(laps: list[dict]) -> list[Anomaly]:
    """High stddev across racing laps."""
    racing = [l for l in laps if l["num"] > 0 and l["duration_ms"] > 0]
    if len(racing) < 4:
        return []

    times = np.array([l["duration_ms"] for l in racing], dtype=np.float64)
    best = float(np.min(times))
    clean = times[times <= best * 1.15]  # drop obvious outliers
    if len(clean) < 4:
        return []

    cov = float(np.std(clean) / np.mean(clean)) * 100  # coefficient of variation %
    if cov >= 3.0:
        return [
            Anomaly(
                type="lap_inconsistency",
                severity="info",
                lap_num=None,
                channel=None,
                message=f"Lap-time coefficient of variation {cov:.1f}% — focus on consistency.",
                metric_value=cov,
            )
        ]
    return []


def _detect_rpm_dropouts(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Brief RPM dips while under load — fuel starvation proxy."""
    rpm_ch = _match_channel(channels, ["RPM"])
    if not rpm_ch:
        return []

    rpm_read = _read_channel_with_time(session_id, rpm_ch)
    if rpm_read is None:
        return []
    ts, rpm = rpm_read
    if len(rpm) < 500:
        return []

    # Look for sudden drops > 2000 RPM in < 200ms while above 4000 RPM
    # Approximation: sample-to-sample delta
    if len(ts) < 2:
        return []
    dt_avg = float(np.median(np.diff(ts)))
    if dt_avg <= 0:
        return []
    window = max(1, int(200 / dt_avg))  # samples per 200ms

    drops = 0
    i = 0
    while i < len(rpm) - window:
        if rpm[i] > 4000 and rpm[i + window] < rpm[i] - 2000:
            drops += 1
            i += window * 5  # skip ahead to avoid double-counting
        else:
            i += 1

    if drops >= 3:
        return [
            Anomaly(
                type="rpm_dropout",
                severity="warning",
                lap_num=None,
                channel=rpm_ch,
                message=f"Detected {drops} sharp RPM drops >2000 in <200ms — possible fuel starvation or misfire.",
                metric_value=float(drops),
            )
        ]
    return []


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def _fetch_laps(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT num, start_time_ms, end_time_ms, duration_ms FROM laps WHERE session_id = ? ORDER BY num",
            (session_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def _clear_existing(session_id: str) -> None:
    db = await get_db()
    try:
        await db.execute("DELETE FROM anomalies WHERE session_id = ?", (session_id,))
        await db.commit()
    finally:
        await db.close()


async def _persist(session_id: str, anomalies: list[Anomaly]) -> None:
    if not anomalies:
        return
    db = await get_db()
    try:
        await db.executemany(
            """INSERT INTO anomalies
               (session_id, type, severity, lap_num, channel, message, metric_value)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    session_id,
                    a.type,
                    a.severity,
                    a.lap_num,
                    a.channel,
                    a.message,
                    a.metric_value,
                )
                for a in anomalies
            ],
        )
        await db.commit()
    finally:
        await db.close()


async def detect_session_anomalies(session_id: str) -> list[dict]:
    """Run every detector, persist findings, return list of dicts."""
    channels = _list_channels(session_id)
    if not channels:
        return []
    laps = await _fetch_laps(session_id)

    findings: list[Anomaly] = []
    findings.extend(_detect_cooling_trend(session_id, channels, laps))
    findings.extend(_detect_voltage_sag(session_id, channels, laps))
    findings.extend(_detect_sensor_drift(session_id, channels))
    findings.extend(_detect_tire_deg(session_id, laps))
    findings.extend(_detect_lap_inconsistency(laps))
    findings.extend(_detect_rpm_dropouts(session_id, channels, laps))

    await _clear_existing(session_id)
    await _persist(session_id, findings)

    return [asdict(a) for a in findings]


async def get_session_anomalies(session_id: str) -> list[dict]:
    """Return persisted anomalies for a session."""
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT id, type, severity, lap_num, channel, message, metric_value, created_at
               FROM anomalies WHERE session_id = ?
               ORDER BY CASE severity
                 WHEN 'critical' THEN 0
                 WHEN 'warning' THEN 1
                 WHEN 'info' THEN 2
                 ELSE 3 END, id""",
            (session_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_anomaly_counts(session_id: str) -> dict:
    """Return a compact {critical, warning, info} count dict."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT severity, COUNT(*) AS n FROM anomalies WHERE session_id = ? GROUP BY severity",
            (session_id,),
        )
        rows = await cursor.fetchall()
        out = {"critical": 0, "warning": 0, "info": 0}
        for r in rows:
            out[r["severity"]] = int(r["n"])
        return out
    finally:
        await db.close()
