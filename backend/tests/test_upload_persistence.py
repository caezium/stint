import tempfile
import unittest
from pathlib import Path
import sys

import aiosqlite

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.database import SCHEMA
from app.routers.upload import persist_session


class PersistSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "telemetry.db"
        self.db = await aiosqlite.connect(self.db_path)
        self.db.row_factory = aiosqlite.Row
        await self.db.executescript(SCHEMA)
        await self.db.commit()

    async def asyncTearDown(self) -> None:
        await self.db.close()
        self.tmpdir.cleanup()

    async def test_reimport_refreshes_children_without_losing_session_fields(self) -> None:
        original = {
            "session_id": "session_1",
            "file_name": "first.xrk",
            "driver": "Driver A",
            "vehicle": "Kart 1",
            "venue": "Suzuka",
            "log_date": "2026-04-10",
            "log_time": "10:00",
            "session_name": "Practice",
            "series": "Club",
            "logger_model": "AiM",
            "logger_id": 7,
            "lap_count": 2,
            "best_lap_time_ms": 60000,
            "total_duration_ms": 130000,
            "channels": [
                {
                    "name": "RPM",
                    "units": "rpm",
                    "dec_pts": 0,
                    "sample_count": 10,
                    "interpolate": True,
                    "function_name": "",
                    "category": "Engine",
                }
            ],
            "laps": [
                {
                    "num": 1,
                    "start_time_ms": 0,
                    "end_time_ms": 60000,
                    "duration_ms": 60000,
                },
                {
                    "num": 2,
                    "start_time_ms": 60000,
                    "end_time_ms": 130000,
                    "duration_ms": 70000,
                },
            ],
        }

        reimported = {
            **original,
            "file_name": "updated.xrk",
            "driver": "Driver B",
            "lap_count": 1,
            "best_lap_time_ms": 59000,
            "total_duration_ms": 59000,
            "channels": [
                {
                    "name": "GPS Speed",
                    "units": "km/h",
                    "dec_pts": 1,
                    "sample_count": 5,
                    "interpolate": True,
                    "function_name": "",
                    "category": "Speed",
                }
            ],
            "laps": [
                {
                    "num": 1,
                    "start_time_ms": 0,
                    "end_time_ms": 59000,
                    "duration_ms": 59000,
                }
            ],
        }

        await persist_session(self.db, original)
        await persist_session(self.db, reimported)
        await self.db.commit()

        session = await (await self.db.execute(
            "SELECT file_name, driver, lap_count, best_lap_time_ms FROM sessions WHERE id = ?",
            ("session_1",),
        )).fetchone()
        self.assertEqual(dict(session), {
            "file_name": "updated.xrk",
            "driver": "Driver B",
            "lap_count": 1,
            "best_lap_time_ms": 59000,
        })

        channels = await (await self.db.execute(
            "SELECT name FROM channels WHERE session_id = ? ORDER BY name",
            ("session_1",),
        )).fetchall()
        self.assertEqual([row["name"] for row in channels], ["GPS Speed"])

        laps = await (await self.db.execute(
            "SELECT num, duration_ms FROM laps WHERE session_id = ? ORDER BY num",
            ("session_1",),
        )).fetchall()
        self.assertEqual([tuple(row) for row in laps], [(1, 59000)])
