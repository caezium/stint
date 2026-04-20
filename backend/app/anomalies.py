"""
Anomaly detection for racing telemetry sessions.

Pure-NumPy statistical checks against cached channel data. No ML dependencies.
Each detector returns ``list[Anomaly]`` and (where possible) populates the
lap-relative location of the offending sample (``distance_pct`` /
``time_in_lap_ms``) so the UI can drop the user at the right spot.

Entry point: ``detect_session_anomalies(session_id)``.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np

from .channels import (
    list_channels as _list_channels,
    match_channel as _match_channel,
    read_channel as _read_channel,
    read_channel_with_time as _read_channel_with_time,
    lap_pct_for_timestamp as _lap_pct_for_timestamp,
)
from .database import get_db


Severity = str  # "info" | "warning" | "critical"


@dataclass
class Anomaly:
    type: str
    severity: Severity
    lap_num: Optional[int]
    channel: Optional[str]
    message: str
    metric_value: Optional[float]
    distance_pct: Optional[float] = None
    time_in_lap_ms: Optional[int] = None


# ---------------------------------------------------------------------------
# Detectors
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
        per_lap_peak_ts: list[float] = []
        for lap in laps:
            if lap["num"] <= 0 or lap["duration_ms"] <= 0:
                continue
            mask = (ts_ms >= lap["start_time_ms"]) & (ts_ms <= lap["end_time_ms"])
            if not np.any(mask):
                continue
            lap_vals = val[mask]
            lap_ts = ts_ms[mask]
            argmax = int(np.argmax(lap_vals))
            per_lap_max.append(float(lap_vals[argmax]))
            per_lap_num.append(lap["num"])
            per_lap_peak_ts.append(float(lap_ts[argmax]))

        if len(per_lap_max) < 3:
            continue

        x = np.arange(len(per_lap_max), dtype=np.float64)
        y = np.array(per_lap_max, dtype=np.float64)
        slope = float(np.polyfit(x, y, 1)[0])
        peak_idx = int(np.argmax(y))
        peak = float(y[peak_idx])

        peak_critical = 130.0 if label == "oil" else 105.0
        peak_warning = 120.0 if label == "oil" else 100.0

        if peak >= peak_critical or peak >= peak_warning:
            sev = "critical" if peak >= peak_critical else "warning"
            tail = (
                "above safe threshold." if sev == "critical" else "approaching warning zone."
            )
            _, pct, in_lap = _lap_pct_for_timestamp(laps, per_lap_peak_ts[peak_idx])
            results.append(
                Anomaly(
                    type="cooling_peak",
                    severity=sev,
                    lap_num=per_lap_num[peak_idx],
                    channel=ch,
                    message=f"{ch} peaked at {peak:.1f}°C — {tail}",
                    metric_value=peak,
                    distance_pct=pct,
                    time_in_lap_ms=in_lap,
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


_INTERNAL_BATTERY_RE = __import__("re").compile(
    r"internal\s*battery|logger\s*battery|backup\s*battery|ecu\s*internal",
    __import__("re").IGNORECASE,
)


def _detect_voltage_sag(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    ch = _match_channel(channels, ["Battery", "BattVolt", " Voltage"])
    if not ch:
        return []

    # Skip AiM-logger internal/backup cells — they run at ~3.7V (LiFePO4) and
    # are not the vehicle system. A 3.7V reading from "Internal Battery" is
    # normal, not a critical alternator fault.
    if _INTERNAL_BATTERY_RE.search(ch):
        return []

    read = _read_channel_with_time(session_id, ch)
    if read is None:
        return []
    ts_ms, vals = read
    if len(vals) < 10:
        return []

    good_mask = vals > 1.0
    good = vals[good_mask]
    if len(good) < 10:
        return []
    good_ts = ts_ms[good_mask]

    vmin_idx_in_good = int(np.argmin(good))
    vmin = float(good[vmin_idx_in_good])
    vmax = float(np.max(good))
    vmean = float(np.mean(good))
    vmin_ts = float(good_ts[vmin_idx_in_good])

    # If the peak observed voltage is below 10V, we're not looking at a 12V
    # system — this is a logger internal cell that slipped past the name
    # filter. Don't emit car-centric thresholds against it.
    if vmax < 10.0:
        return []

    lap_num, pct, in_lap = _lap_pct_for_timestamp(laps, vmin_ts)

    results: list[Anomaly] = []
    if vmin < 11.0 and vmean < 13.0:
        results.append(
            Anomaly(
                type="voltage_sag",
                severity="critical",
                lap_num=lap_num,
                channel=ch,
                message=f"{ch} dropped to {vmin:.1f}V (avg {vmean:.1f}V) — alternator or battery issue.",
                metric_value=vmin,
                distance_pct=pct,
                time_in_lap_ms=in_lap,
            )
        )
    elif vmin < 12.0 and vmean < 13.2:
        results.append(
            Anomaly(
                type="voltage_sag",
                severity="warning",
                lap_num=lap_num,
                channel=ch,
                message=f"{ch} dropped to {vmin:.1f}V — check charging system.",
                metric_value=vmin,
                distance_pct=pct,
                time_in_lap_ms=in_lap,
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


def _detect_sensor_drift(session_id: str, channels: list[str]) -> list[Anomaly]:
    """Flat-line / clipping detection on key channels."""
    results: list[Anomaly] = []
    targets = [
        ("RPM", ["RPM"]),
        ("Speed", ["GPS Speed", "Speed"]),
        ("Throttle", ["TPS", "Throttle"]),
    ]
    for _label, needles in targets:
        ch = _match_channel(channels, needles)
        if not ch:
            continue
        vals = _read_channel(session_id, ch)
        if vals is None or len(vals) < 100:
            continue

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


def _detect_tire_deg(laps: list[dict]) -> list[Anomaly]:
    """Lap time decay across non-pit laps."""
    racing = [
        l for l in laps
        if l["num"] > 0 and l["duration_ms"] > 0 and not l.get("is_pit_lap")
    ]
    if len(racing) < 5:
        return []

    times = np.array([l["duration_ms"] for l in racing], dtype=np.float64)
    best = float(np.min(times))
    clean_mask = times <= best * 1.2
    times_clean = times[clean_mask]
    if len(times_clean) < 5:
        return []

    x = np.arange(len(times_clean), dtype=np.float64)
    slope = float(np.polyfit(x, times_clean, 1)[0])

    if slope >= 150.0:
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
    racing = [
        l for l in laps
        if l["num"] > 0 and l["duration_ms"] > 0 and not l.get("is_pit_lap")
    ]
    if len(racing) < 4:
        return []

    times = np.array([l["duration_ms"] for l in racing], dtype=np.float64)
    best = float(np.min(times))
    clean = times[times <= best * 1.15]
    if len(clean) < 4:
        return []

    cov = float(np.std(clean) / np.mean(clean)) * 100
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
    """Sharp RPM drops while under load — fuel starvation proxy.

    Karting-aware: thresholds scale with peak RPM so that a 15000 RPM kart
    motor's routine driver-lifts aren't mistaken for misfires. When a
    throttle channel is available, only count drops that happen while
    throttle is >50% (real fuel starvation, not lifting into a corner).
    """
    rpm_ch = _match_channel(channels, ["RPM"])
    if not rpm_ch:
        return []

    rpm_read = _read_channel_with_time(session_id, rpm_ch)
    if rpm_read is None:
        return []
    ts, rpm = rpm_read
    if len(rpm) < 500 or len(ts) < 2:
        return []

    dt_avg = float(np.median(np.diff(ts)))
    if dt_avg <= 0:
        return []
    window = max(1, int(200 / dt_avg))

    # Scale thresholds by peak RPM. A kart at 15000 RPM drops 3000+ RPM every
    # time the driver lifts; that's not a fault.
    peak_rpm = float(np.percentile(rpm, 99)) if len(rpm) >= 100 else 0.0
    drop_threshold = max(2000.0, 0.20 * peak_rpm)
    initial_threshold = max(4000.0, 0.35 * peak_rpm)

    # Try to read throttle so we can mask out driver-lift events.
    throttle_mask_fn = None
    thr_ch = _match_channel(channels, ["Throttle", "TPS", "Pedal Pos"])
    if thr_ch:
        thr_read = _read_channel_with_time(session_id, thr_ch)
        if thr_read is not None:
            thr_ts, thr_vals = thr_read
            # Normalise to 0-100 if it looks like 0-1.
            if len(thr_vals) > 0 and float(np.nanmax(thr_vals)) <= 1.5:
                thr_vals = thr_vals * 100.0

            def throttle_at(t: float) -> float:
                idx = int(np.searchsorted(thr_ts, t))
                if idx >= len(thr_vals):
                    idx = len(thr_vals) - 1
                return float(thr_vals[idx])

            throttle_mask_fn = throttle_at

    drops = 0
    first_drop_ts: Optional[float] = None
    i = 0
    while i < len(rpm) - window:
        if rpm[i] > initial_threshold and rpm[i + window] < rpm[i] - drop_threshold:
            # If throttle data is available, require throttle > 50% at the
            # start of the drop — otherwise the driver is just lifting.
            if throttle_mask_fn is not None:
                thr = throttle_mask_fn(float(ts[i]))
                if thr < 50.0:
                    i += 1
                    continue
            drops += 1
            if first_drop_ts is None:
                first_drop_ts = float(ts[i])
            i += window * 5
        else:
            i += 1

    # Raise the minimum count; karts are noisy.
    if drops >= 5:
        lap_num, pct, in_lap = (None, None, None)
        if first_drop_ts is not None:
            lap_num, pct, in_lap = _lap_pct_for_timestamp(laps, first_drop_ts)
        # Severity: only elevate to warning if the drop pattern is extreme.
        severity = "warning" if drops >= 10 else "info"
        return [
            Anomaly(
                type="rpm_dropout",
                severity=severity,
                lap_num=lap_num,
                channel=rpm_ch,
                message=f"Detected {drops} sharp RPM drops >{drop_threshold:.0f} in <200ms while on-throttle — possible fuel starvation or misfire.",
                metric_value=float(drops),
                distance_pct=pct,
                time_in_lap_ms=in_lap,
            )
        ]
    return []


# ---------------------------------------------------------------------------
# T2.3 — New detectors
# ---------------------------------------------------------------------------


def _detect_pit_in(
    session_id: str, channels: list[str], laps: list[dict]
) -> tuple[list[Anomaly], set[int]]:
    """Identify in/out laps with sustained low-speed sections.

    Returns the (anomalies, pit_lap_nums) pair so the orchestrator can persist
    `is_pit_lap=1` on those rows.

    Karting-aware: thresholds scale with the session's p90 speed so a kart
    session (top speed ~60 kph) doesn't get every lap flagged.
    """
    speed_ch = _match_channel(channels, ["GPS Speed", "Speed"])
    if not speed_ch:
        return [], set()
    read = _read_channel_with_time(session_id, speed_ch)
    if read is None:
        return [], set()
    ts, speed = read
    if len(speed) < 200:
        return [], set()

    dt_avg = float(np.median(np.diff(ts))) if len(ts) >= 2 else 0.0
    if dt_avg <= 0:
        return [], set()

    # Karting-aware threshold: scale by session p90 speed.
    # Cars: p90 ~200 kph → threshold 40 kph (20%).
    # Karts: p90 ~60 kph → threshold 21 kph (35% of p90, min 15).
    p90 = float(np.percentile(speed, 90)) if len(speed) >= 10 else 0.0
    is_karting = p90 < 90.0
    if is_karting:
        threshold_kph = max(15.0, 0.35 * p90)
        min_run_ms = 8_000.0
    else:
        threshold_kph = 40.0
        min_run_ms = 5_000.0
    edge_frac = 0.15

    pit_laps: set[int] = set()
    anomalies: list[Anomaly] = []

    for lap in laps:
        if lap["num"] <= 0 or lap["duration_ms"] <= 0:
            continue
        mask = (ts >= lap["start_time_ms"]) & (ts <= lap["end_time_ms"])
        if not np.any(mask):
            continue
        lap_speed = speed[mask]
        n = len(lap_speed)
        if n < 10:
            continue

        # A lap where the *median* speed is below threshold is a cruise/install
        # lap, not a racing lap with a pit segment. Skip it without flagging.
        lap_median = float(np.median(lap_speed))
        if lap_median < threshold_kph:
            continue

        below = lap_speed < threshold_kph

        # Find the longest contiguous run below threshold and where it lives
        best_run = 0
        best_start = 0
        run = 0
        run_start = 0
        for i, b in enumerate(below):
            if b:
                if run == 0:
                    run_start = i
                run += 1
                if run > best_run:
                    best_run = run
                    best_start = run_start
            else:
                run = 0
        if best_run < 2:
            continue

        run_ms = best_run * dt_avg
        if run_ms < min_run_ms:
            continue

        # Lap-relative position of the slow segment (0-1 each)
        start_frac = best_start / n
        end_frac = (best_start + best_run) / n
        touches_start = start_frac <= edge_frac
        touches_end = end_frac >= (1.0 - edge_frac)
        if not (touches_start or touches_end):
            # Mid-lap slow section — that's a corner, not a pit.
            continue

        # Require a genuine dwell: a contiguous stretch at near-zero speed
        # within the slow run. Real pit stops/pit-in crawls have this; slow
        # corners do not.
        slow_segment = lap_speed[best_start:best_start + best_run]
        near_stop_threshold = max(5.0, 0.25 * threshold_kph)
        near_stop = slow_segment < near_stop_threshold
        # Longest contiguous run of near-stop samples
        ns_best = 0
        ns_run = 0
        for b in near_stop:
            if b:
                ns_run += 1
                if ns_run > ns_best:
                    ns_best = ns_run
            else:
                ns_run = 0
        ns_ms = ns_best * dt_avg
        if ns_ms < 3_000.0:
            # No 3-second near-stop dwell — probably a hairpin at the lap
            # boundary, not a true in/out lap.
            continue

        pit_laps.add(int(lap["num"]))
        where = "out-lap" if touches_start and not touches_end else (
            "in-lap" if touches_end and not touches_start else "in/out lap"
        )
        anomalies.append(
            Anomaly(
                type="pit_lap",
                severity="info",
                lap_num=int(lap["num"]),
                channel=speed_ch,
                message=f"L{lap['num']} looks like an {where} ({run_ms/1000:.0f}s sustained <{threshold_kph:.0f} km/h at lap boundary) — excluded from pace stats.",
                metric_value=float(run_ms),
            )
        )
    return anomalies, pit_laps


def _detect_brake_fade(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Track peak brake pressure / peak deceleration ratio across stints."""
    brake_ch = _match_channel(channels, ["BrakePress", "Brake Pressure", "Brake"])
    speed_ch = _match_channel(channels, ["GPS Speed", "Speed"])
    if not brake_ch or not speed_ch:
        return []
    b_read = _read_channel_with_time(session_id, brake_ch)
    s_read = _read_channel_with_time(session_id, speed_ch)
    if b_read is None or s_read is None:
        return []
    bts, brake = b_read
    sts, speed = s_read

    racing = [
        l for l in laps
        if l["num"] > 0 and l["duration_ms"] > 0 and not l.get("is_pit_lap")
    ]
    if len(racing) < 4:
        return []

    ratios: list[float] = []
    lap_nums: list[int] = []
    for lap in racing:
        bmask = (bts >= lap["start_time_ms"]) & (bts <= lap["end_time_ms"])
        smask = (sts >= lap["start_time_ms"]) & (sts <= lap["end_time_ms"])
        if not np.any(bmask) or np.sum(smask) < 10:
            continue
        peak_b = float(np.max(brake[bmask]))
        if peak_b < 5.0:
            continue
        # Peak decel = max negative dv/dt over the lap (m/s^2 if speed in m/s,
        # km/h derivative is fine for ratio purposes)
        lap_speed = speed[smask]
        lap_sts = sts[smask]
        if len(lap_speed) < 2:
            continue
        dv = np.diff(lap_speed)
        dt = np.diff(lap_sts) / 1000.0
        dt[dt <= 0] = np.nan
        decel = -dv / dt
        peak_decel = float(np.nanmax(decel)) if np.any(np.isfinite(decel)) else 0.0
        if peak_decel <= 0:
            continue
        ratios.append(peak_b / peak_decel)
        lap_nums.append(int(lap["num"]))

    # Need at least two stints of 3 laps each
    if len(ratios) < 6:
        return []

    arr = np.array(ratios, dtype=np.float64)
    n = len(arr)
    half = n // 2
    early = arr[:half]
    late = arr[half:]
    early_med = float(np.median(early))
    late_med = float(np.median(late))

    if early_med <= 0:
        return []
    delta_pct = (late_med - early_med) / early_med * 100.0
    # >25% more pressure for the same decel = fade
    if delta_pct >= 25.0:
        return [
            Anomaly(
                type="brake_fade",
                severity="warning",
                lap_num=int(lap_nums[-1]),
                channel=brake_ch,
                message=(
                    f"Brake pressure-to-decel ratio rose {delta_pct:.0f}% from early to late "
                    "stint — possible brake fade."
                ),
                metric_value=delta_pct,
            )
        ]
    return []


def _detect_handling(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Yaw vs steering residual at lat-G > 0.7 → understeer / oversteer."""
    yaw_ch = _match_channel(channels, ["Yaw", "GyroZ"])
    steer_ch = _match_channel(channels, ["Steering", "Steer"])
    latg_ch = _match_channel(channels, ["LatAcc", "Lat G", "Lateral", "AccLat"])
    if not yaw_ch or not steer_ch or not latg_ch:
        return []
    y = _read_channel(session_id, yaw_ch)
    s = _read_channel(session_id, steer_ch)
    g = _read_channel(session_id, latg_ch)
    if y is None or s is None or g is None:
        return []
    n = min(len(y), len(s), len(g))
    if n < 500:
        return []
    y, s, g = y[:n], s[:n], g[:n]

    mask = np.abs(g) > 0.7
    if np.sum(mask) < 100:
        return []
    yh = y[mask]
    sh = s[mask]
    if float(np.std(sh)) < 1e-3:
        return []

    # Linear regression yaw ~ k * steer
    coef = float(np.polyfit(sh, yh, 1)[0])
    residuals = yh - coef * sh
    bias = float(np.mean(residuals))
    rstd = float(np.std(residuals))
    if rstd < 1e-3:
        return []

    bias_n = bias / rstd
    out: list[Anomaly] = []
    if bias_n < -0.5:
        out.append(
            Anomaly(
                type="understeer",
                severity="info",
                lap_num=None,
                channel=yaw_ch,
                message=(
                    "Yaw response trails steering input under high lat-G — car shows understeer "
                    "balance."
                ),
                metric_value=round(bias_n, 2),
            )
        )
    elif bias_n > 0.5:
        out.append(
            Anomaly(
                type="oversteer",
                severity="warning",
                lap_num=None,
                channel=yaw_ch,
                message=(
                    "Yaw response leads steering input under high lat-G — car shows oversteer "
                    "balance."
                ),
                metric_value=round(bias_n, 2),
            )
        )
    return out


def _detect_traction_loss(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """WheelSpeed - GPS Speed excursions = wheelspin."""
    wf_ch = _match_channel(channels, ["WheelSpeedF", "Wheel Speed F", "WheelSpd_FL"])
    speed_ch = _match_channel(channels, ["GPS Speed", "Speed"])
    if not wf_ch or not speed_ch:
        return []
    w_read = _read_channel_with_time(session_id, wf_ch)
    s_read = _read_channel_with_time(session_id, speed_ch)
    if w_read is None or s_read is None:
        return []
    wts, w = w_read
    sts, sp = s_read

    n = min(len(w), len(sp), len(wts), len(sts))
    if n < 200:
        return []
    diff = w[:n] - sp[:n]
    excursions = int(np.sum(diff > 5.0))
    # Need at least ~100ms of cumulative excursion to flag
    dt_avg = float(np.median(np.diff(wts[:n]))) if n >= 2 else 0.0
    if dt_avg <= 0:
        return []
    excursion_ms = excursions * dt_avg
    if excursion_ms < 500:
        return []
    return [
        Anomaly(
            type="traction_loss",
            severity="info",
            lap_num=None,
            channel=wf_ch,
            message=(
                f"Front wheels exceeded GPS speed by >5 km/h for ~{excursion_ms:.0f}ms total "
                "— wheelspin events."
            ),
            metric_value=float(excursion_ms),
        )
    ]


def _detect_pedal_tps_mismatch(
    session_id: str, channels: list[str]
) -> list[Anomaly]:
    """Pearson correlation between pedal and TPS over rolling 5s windows."""
    pedal_ch = _match_channel(channels, ["Pedal", "ThrottlePedal", "AccPedal"])
    tps_ch = _match_channel(channels, ["TPS", "Throttle"])
    if not pedal_ch or not tps_ch or pedal_ch == tps_ch:
        return []
    p_read = _read_channel_with_time(session_id, pedal_ch)
    t_read = _read_channel_with_time(session_id, tps_ch)
    if p_read is None or t_read is None:
        return []
    pts, ped = p_read
    tts, tps = t_read

    n = min(len(ped), len(tps))
    if n < 1000:
        return []
    ped, tps = ped[:n], tps[:n]
    dt_avg = float(np.median(np.diff(pts[:n]))) if n >= 2 else 0.0
    if dt_avg <= 0:
        return []
    win = max(50, int(5000 / dt_avg))

    bad = 0
    for i in range(0, n - win, win):
        a = ped[i : i + win]
        b = tps[i : i + win]
        if float(np.std(a)) < 1.0 or float(np.std(b)) < 1.0:
            continue
        r = float(np.corrcoef(a, b)[0, 1])
        if r < 0.85:
            bad += 1
    if bad >= 2:
        return [
            Anomaly(
                type="pedal_tps_mismatch",
                severity="warning",
                lap_num=None,
                channel=tps_ch,
                message=(
                    f"Pedal and TPS correlation dropped below 0.85 in {bad} 5-second windows — "
                    "possible drive-by-wire or sensor issue."
                ),
                metric_value=float(bad),
            )
        ]
    return []


def _detect_gear_shift_latency(
    session_id: str, channels: list[str], laps: list[dict]
) -> list[Anomaly]:
    """Inconsistent RPM-drop magnitude on shifts → torque interruption variance."""
    rpm_ch = _match_channel(channels, ["RPM"])
    if not rpm_ch:
        return []
    read = _read_channel_with_time(session_id, rpm_ch)
    if read is None:
        return []
    ts, rpm = read
    if len(rpm) < 1000:
        return []
    dt_avg = float(np.median(np.diff(ts))) if len(ts) >= 2 else 0.0
    if dt_avg <= 0:
        return []
    window = max(1, int(150 / dt_avg))

    drops: list[float] = []
    i = 0
    while i < len(rpm) - window:
        if rpm[i] > 4000:
            d = float(rpm[i] - rpm[i + window])
            if 800 < d < 2500:  # plausible upshift drop
                drops.append(d)
                i += window * 4
                continue
        i += 1
    if len(drops) < 8:
        return []
    arr = np.array(drops)
    mean_d = float(np.mean(arr))
    std_d = float(np.std(arr))
    if mean_d <= 0:
        return []
    cov = std_d / mean_d
    if cov >= 0.35:
        return [
            Anomaly(
                type="gear_shift_inconsistency",
                severity="info",
                lap_num=None,
                channel=rpm_ch,
                message=(
                    f"Up-shift RPM drops vary by ±{cov*100:.0f}% across {len(drops)} shifts "
                    "— inconsistent shift technique or driveline issue."
                ),
                metric_value=round(cov, 3),
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
            "SELECT num, start_time_ms, end_time_ms, duration_ms, is_pit_lap "
            "FROM laps WHERE session_id = ? ORDER BY num",
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
               (session_id, type, severity, lap_num, channel, message,
                metric_value, distance_pct, time_in_lap_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    session_id,
                    a.type,
                    a.severity,
                    a.lap_num,
                    a.channel,
                    a.message,
                    a.metric_value,
                    a.distance_pct,
                    a.time_in_lap_ms,
                )
                for a in anomalies
            ],
        )
        await db.commit()
    finally:
        await db.close()


async def _set_pit_laps(session_id: str, pit_laps: set[int]) -> None:
    if not pit_laps:
        return
    db = await get_db()
    try:
        # Clear any prior pit flags first so a re-run reflects current detection
        await db.execute(
            "UPDATE laps SET is_pit_lap = 0 WHERE session_id = ?", (session_id,)
        )
        await db.executemany(
            "UPDATE laps SET is_pit_lap = 1 WHERE session_id = ? AND num = ?",
            [(session_id, n) for n in pit_laps],
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

    # Pit detection runs first so subsequent detectors can exclude in/out laps
    pit_anomalies, pit_laps = _detect_pit_in(session_id, channels, laps)
    if pit_laps:
        await _set_pit_laps(session_id, pit_laps)
        for lap in laps:
            if lap["num"] in pit_laps:
                lap["is_pit_lap"] = 1

    findings: list[Anomaly] = []
    findings.extend(pit_anomalies)
    findings.extend(_detect_cooling_trend(session_id, channels, laps))
    findings.extend(_detect_voltage_sag(session_id, channels, laps))
    findings.extend(_detect_sensor_drift(session_id, channels))
    findings.extend(_detect_tire_deg(laps))
    findings.extend(_detect_lap_inconsistency(laps))
    findings.extend(_detect_rpm_dropouts(session_id, channels, laps))
    findings.extend(_detect_brake_fade(session_id, channels, laps))
    findings.extend(_detect_handling(session_id, channels, laps))
    findings.extend(_detect_traction_loss(session_id, channels, laps))
    findings.extend(_detect_pedal_tps_mismatch(session_id, channels))
    findings.extend(_detect_gear_shift_latency(session_id, channels, laps))

    await _clear_existing(session_id)
    await _persist(session_id, findings)
    return [asdict(a) for a in findings]


async def get_session_anomalies(session_id: str) -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT id, type, severity, lap_num, channel, message,
                      metric_value, distance_pct, time_in_lap_ms, created_at
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
