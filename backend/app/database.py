"""SQLite database for session and channel metadata."""

import aiosqlite
import os

DB_PATH = os.environ.get("DB_PATH", "/app/data/telemetry.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    driver TEXT DEFAULT '',
    vehicle TEXT DEFAULT '',
    venue TEXT DEFAULT '',
    log_date TEXT DEFAULT '',
    log_time TEXT DEFAULT '',
    session_name TEXT DEFAULT '',
    series TEXT DEFAULT '',
    logger_model TEXT DEFAULT '',
    logger_id INTEGER DEFAULT 0,
    lap_count INTEGER DEFAULT 0,
    best_lap_time_ms INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS channels (
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    units TEXT DEFAULT '',
    dec_pts INTEGER DEFAULT 1,
    sample_count INTEGER DEFAULT 0,
    interpolate BOOLEAN DEFAULT 1,
    function_name TEXT DEFAULT '',
    category TEXT DEFAULT 'Other',
    PRIMARY KEY (session_id, name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS laps (
    session_id TEXT NOT NULL,
    num INTEGER NOT NULL,
    start_time_ms INTEGER NOT NULL,
    end_time_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, num),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sectors (
    session_id TEXT NOT NULL,
    sector_num INTEGER NOT NULL,
    start_distance_m REAL NOT NULL,
    end_distance_m REAL NOT NULL,
    label TEXT DEFAULT '',
    PRIMARY KEY (session_id, sector_num),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sector_times (
    session_id TEXT NOT NULL,
    lap_num INTEGER NOT NULL,
    sector_num INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, lap_num, sector_num),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS math_channels (
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    formula TEXT NOT NULL,
    units TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    config_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_notes (
    session_id TEXT PRIMARY KEY,
    note_text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    weight_kg REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    class TEXT DEFAULT '',
    engine TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
"""


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)
    await db.commit()
    await db.close()
