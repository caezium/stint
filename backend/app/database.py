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

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT DEFAULT '',
    length_m REAL DEFAULT 0,
    gps_outline_json TEXT DEFAULT '[]',
    sector_defs_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
);
"""


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def _migrate(db: aiosqlite.Connection) -> None:
    """Apply additive migrations. Idempotent; safe to run at every startup."""
    cur = await db.execute("PRAGMA table_info(sessions)")
    cols = {row[1] for row in await cur.fetchall()}
    if "driver_id" not in cols:
        await db.execute("ALTER TABLE sessions ADD COLUMN driver_id INTEGER REFERENCES drivers(id)")
    if "vehicle_id" not in cols:
        await db.execute("ALTER TABLE sessions ADD COLUMN vehicle_id INTEGER REFERENCES vehicles(id)")
    if "track_id" not in cols:
        await db.execute("ALTER TABLE sessions ADD COLUMN track_id INTEGER REFERENCES tracks(id)")

    # Tracks widening
    cur = await db.execute("PRAGMA table_info(tracks)")
    tcols = {row[1] for row in await cur.fetchall()}
    for col, ddl in [
        ("short_name", "ALTER TABLE tracks ADD COLUMN short_name TEXT DEFAULT ''"),
        ("city", "ALTER TABLE tracks ADD COLUMN city TEXT DEFAULT ''"),
        ("type", "ALTER TABLE tracks ADD COLUMN type TEXT DEFAULT ''"),
        ("surface", "ALTER TABLE tracks ADD COLUMN surface TEXT DEFAULT ''"),
        ("timezone", "ALTER TABLE tracks ADD COLUMN timezone TEXT DEFAULT ''"),
        ("sf_line_json", "ALTER TABLE tracks ADD COLUMN sf_line_json TEXT DEFAULT ''"),
        ("split_lines_json", "ALTER TABLE tracks ADD COLUMN split_lines_json TEXT DEFAULT '[]'"),
        ("pit_lane_json", "ALTER TABLE tracks ADD COLUMN pit_lane_json TEXT DEFAULT '[]'"),
    ]:
        if col not in tcols:
            await db.execute(ddl)

    # Laps: split_times_json
    cur = await db.execute("PRAGMA table_info(laps)")
    lcols = {row[1] for row in await cur.fetchall()}
    if "split_times_json" not in lcols:
        await db.execute("ALTER TABLE laps ADD COLUMN split_times_json TEXT DEFAULT ''")

    # Log sheets table
    await db.execute(
        """CREATE TABLE IF NOT EXISTS session_log_sheets (
            session_id TEXT PRIMARY KEY,
            weather TEXT DEFAULT '',
            track_temp REAL DEFAULT 0,
            air_temp REAL DEFAULT 0,
            tire_pressures_json TEXT DEFAULT '',
            setup_notes TEXT DEFAULT '',
            fuel_level REAL DEFAULT 0,
            driver_rating INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Smart collections
    await db.execute(
        """CREATE TABLE IF NOT EXISTS smart_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            query_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )"""
    )

    # User settings KV
    await db.execute(
        """CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        )"""
    )

    # Anomalies (populated by backend/app/anomalies.py after upload)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS anomalies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            type TEXT NOT NULL,
            severity TEXT NOT NULL,
            lap_num INTEGER,
            channel TEXT,
            message TEXT NOT NULL,
            metric_value REAL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_anomalies_session ON anomalies(session_id)"
    )

    # Debriefs cache (populated by backend/app/debrief.py after upload)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS debriefs (
            session_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            generated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Chat conversations (Phase 3: Ask Your Data)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS chat_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            title TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_conv_session ON chat_conversations(session_id)"
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id)"
    )


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)
    await _migrate(db)
    await db.commit()
    await db.close()
