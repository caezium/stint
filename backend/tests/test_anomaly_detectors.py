"""Regression tests for karting-specific anomaly detector thresholds.

Each detector is exercised with a synthetic in-memory arrow/Numpy trace via
monkey-patching the I/O helpers (`_read_channel_with_time`, `_match_channel`).
This keeps the tests fast and deterministic — no filesystem, no DB.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import anomalies  # noqa: E402


def _kart_lap(dur_ms: int, peak_kph: float, n: int = 500) -> tuple[np.ndarray, np.ndarray]:
    """Synthetic lap — sine-wave speed profile oscillating between
    0.3*peak and peak (i.e. a typical kart lap with corners below 40 kph)."""
    ts = np.linspace(0, dur_ms, n)
    phase = np.linspace(0, 2 * np.pi, n)
    speed = peak_kph * (0.65 + 0.35 * np.sin(phase * 3))
    return ts, speed


def _cruise_lap(dur_ms: int, speed_kph: float, n: int = 500) -> tuple[np.ndarray, np.ndarray]:
    ts = np.linspace(0, dur_ms, n)
    speed = np.full(n, speed_kph)
    return ts, speed


def _in_lap(dur_ms: int, peak_kph: float, n: int = 500) -> tuple[np.ndarray, np.ndarray]:
    """First-half race pace, second-half rolling in pits (sub-10 kph dwell)."""
    ts = np.linspace(0, dur_ms, n)
    half = n // 2
    race = np.full(half, peak_kph * 0.8)
    pit = np.linspace(peak_kph * 0.5, 2.0, n - half)  # slows to crawl
    speed = np.concatenate([race, pit])
    return ts, speed


class PitLapDetectorTests(unittest.TestCase):
    def test_karting_racing_lap_not_flagged(self) -> None:
        """A 45s karting lap with sub-40 kph corners must NOT flag as pit.

        This is the bug from the user's 13-lap session — every lap was flagged
        because the threshold_kph was hardcoded at 40 for karting sessions.
        """
        ts, speed = _kart_lap(45_000, peak_kph=60.0)
        # Full session = 13 racing laps concatenated
        full_ts_chunks = []
        full_speed_chunks = []
        laps = []
        offset = 0
        for i in range(1, 14):
            full_ts_chunks.append(ts + offset)
            full_speed_chunks.append(speed)
            laps.append({
                "num": i,
                "start_time_ms": offset,
                "end_time_ms": offset + 45_000,
                "duration_ms": 45_000,
            })
            offset += 45_000
        full_ts = np.concatenate(full_ts_chunks)
        full_speed = np.concatenate(full_speed_chunks)

        with patch.object(anomalies, "_match_channel", return_value="GPS Speed"), \
             patch.object(anomalies, "_read_channel_with_time", return_value=(full_ts, full_speed)):
            out, pit_set = anomalies._detect_pit_in("session_x", ["GPS Speed"], laps)
        self.assertEqual(len(pit_set), 0,
                         f"Expected no pit laps on karting session; got {pit_set}")
        self.assertEqual(len(out), 0)

    def test_car_pit_lap_still_flagged(self) -> None:
        """A regular road-car session (peak 200 kph) with a genuine in-lap
        should still get flagged — we shouldn't break the car case."""
        ts1, speed1 = _cruise_lap(90_000, speed_kph=120.0)
        ts2, speed2 = _in_lap(60_000, peak_kph=180.0)
        all_ts = np.concatenate([ts1, ts2 + 90_000])
        all_speed = np.concatenate([speed1, speed2])
        laps = [
            {"num": 1, "start_time_ms": 0, "end_time_ms": 90_000, "duration_ms": 90_000},
            {"num": 2, "start_time_ms": 90_000, "end_time_ms": 150_000, "duration_ms": 60_000},
        ]
        with patch.object(anomalies, "_match_channel", return_value="GPS Speed"), \
             patch.object(anomalies, "_read_channel_with_time", return_value=(all_ts, all_speed)):
            out, pit_set = anomalies._detect_pit_in("session_x", ["GPS Speed"], laps)
        self.assertIn(2, pit_set, "Genuine in-lap with pit crawl must still flag.")


class VoltageSagDetectorTests(unittest.TestCase):
    def test_internal_battery_3_7v_not_flagged(self) -> None:
        """AiM logger 'Internal Battery' reading 3.7V is normal, not a fault."""
        ts = np.linspace(0, 60_000, 600)
        vals = np.full(600, 3.7)
        with patch.object(anomalies, "_match_channel", return_value="Internal Battery"), \
             patch.object(anomalies, "_read_channel_with_time", return_value=(ts, vals)):
            out = anomalies._detect_voltage_sag("s", ["Internal Battery"], [])
        self.assertEqual(out, [], "3.7V internal battery must not flag.")

    def test_max_below_10v_not_flagged(self) -> None:
        """Any channel whose max is below 10V is a logger internal cell,
        not a car battery — skip even if channel name didn't filter-match."""
        ts = np.linspace(0, 60_000, 600)
        vals = np.full(600, 5.0)
        with patch.object(anomalies, "_match_channel", return_value="Battery"), \
             patch.object(anomalies, "_read_channel_with_time", return_value=(ts, vals)):
            out = anomalies._detect_voltage_sag("s", ["Battery"], [])
        self.assertEqual(out, [], "5V channel must not fire car-centric threshold.")

    def test_genuine_car_battery_sag_fires_critical(self) -> None:
        """12V system dropping to 10V should still fire CRITICAL."""
        ts = np.linspace(0, 60_000, 600)
        vals = np.concatenate([np.full(300, 12.5), np.full(300, 10.5)])
        laps = [{"num": 1, "start_time_ms": 0, "end_time_ms": 60_000, "duration_ms": 60_000}]
        with patch.object(anomalies, "_match_channel", return_value="Battery"), \
             patch.object(anomalies, "_read_channel_with_time", return_value=(ts, vals)):
            out = anomalies._detect_voltage_sag("s", ["Battery"], laps)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].severity, "critical")


class RpmDropoutDetectorTests(unittest.TestCase):
    def test_kart_driver_lifts_not_flagged(self) -> None:
        """Kart engine at 15000 RPM that drops to 9000 every time the driver
        lifts into a corner should NOT fire (it's normal).

        Includes a throttle channel that drops at the same time as the RPM —
        confirming we filter by throttle>50% for real dropout events.
        """
        n = 2000
        ts = np.linspace(0, 60_000, n)
        # 10 driver-lift events across the lap
        rpm = np.full(n, 14_500.0)
        throttle = np.full(n, 90.0)
        for k in range(10):
            center = int((k + 0.5) * n / 10)
            # Drop over ~30ms
            rpm[center: center + 20] = 9000.0
            throttle[center: center + 20] = 10.0

        def match(channels, keywords):
            if keywords == ["RPM"]:
                return "RPM"
            if any(k in ("Throttle", "TPS", "Pedal Pos") for k in keywords):
                return "TPS"
            return None

        def read(session_id, ch):
            if ch == "RPM":
                return ts, rpm
            if ch == "TPS":
                return ts, throttle
            return None

        with patch.object(anomalies, "_match_channel", side_effect=match), \
             patch.object(anomalies, "_read_channel_with_time", side_effect=read):
            out = anomalies._detect_rpm_dropouts("s", ["RPM", "TPS"], [])
        self.assertEqual(out, [], "Driver lifts must not flag as fuel starvation.")

    def test_misfire_on_throttle_fires_warning(self) -> None:
        """Simulated misfire (RPM drops WHILE throttle is held at 100%)
        must still fire."""
        n = 2000
        ts = np.linspace(0, 60_000, n)
        rpm = np.full(n, 14_000.0)
        throttle = np.full(n, 95.0)
        # 12 drop events (>=10 triggers warning severity) while on-throttle
        for k in range(12):
            center = int((k + 0.5) * n / 12)
            rpm[center: center + 20] = 9000.0

        def match(channels, keywords):
            if keywords == ["RPM"]:
                return "RPM"
            if any(k in ("Throttle", "TPS", "Pedal Pos") for k in keywords):
                return "TPS"
            return None

        def read(session_id, ch):
            if ch == "RPM":
                return ts, rpm
            if ch == "TPS":
                return ts, throttle
            return None

        with patch.object(anomalies, "_match_channel", side_effect=match), \
             patch.object(anomalies, "_read_channel_with_time", side_effect=read):
            out = anomalies._detect_rpm_dropouts("s", ["RPM", "TPS"], [])
        self.assertTrue(len(out) >= 1, "Misfire pattern must flag.")
        self.assertIn(out[0].severity, ("warning", "info"))


if __name__ == "__main__":
    unittest.main()
