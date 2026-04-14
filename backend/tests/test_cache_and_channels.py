import tempfile
import unittest
from pathlib import Path
import sys

import pyarrow as pa

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers.channels import _filter_table_by_bounds
from app.xrk_service import _load_cached_metadata, _write_cached_metadata


class CacheAndChannelTests(unittest.TestCase):
    def test_cached_metadata_round_trip(self) -> None:
        payload = {
            "session_id": "session_1",
            "file_name": "test.xrk",
            "driver": "CMD",
            "lap_count": 3,
            "channels": [{"name": "RPM"}],
            "laps": [{"num": 1, "duration_ms": 60000}],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            _write_cached_metadata(tmpdir, payload)
            self.assertEqual(_load_cached_metadata(tmpdir), payload)

    def test_filter_table_by_bounds_uses_timecodes(self) -> None:
        table = pa.table({
            "timecodes": [0, 1000, 2000, 3000],
            "RPM": [10000, 11000, 12000, 13000],
        })

        filtered = _filter_table_by_bounds(table, 1000, 3000)

        self.assertEqual(filtered.column("timecodes").to_pylist(), [1000, 2000])
        self.assertEqual(filtered.column("RPM").to_pylist(), [11000, 12000])
