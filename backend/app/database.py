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

    # ------------------------------------------------------------------
    # Phase 0 / 1 / 2 / 3 / 4 additive migrations for the AI rebaseline
    # ------------------------------------------------------------------

    # chat_messages: token usage + model pinning (Phase 0 / T3.7)
    cur = await db.execute("PRAGMA table_info(chat_messages)")
    cm_cols = {row[1] for row in await cur.fetchall()}
    if "tokens_in" not in cm_cols:
        await db.execute("ALTER TABLE chat_messages ADD COLUMN tokens_in INTEGER")
    if "tokens_out" not in cm_cols:
        await db.execute("ALTER TABLE chat_messages ADD COLUMN tokens_out INTEGER")
    if "model" not in cm_cols:
        await db.execute("ALTER TABLE chat_messages ADD COLUMN model TEXT")

    # chat_conversations: pin a model to a conversation (T3.7)
    cur = await db.execute("PRAGMA table_info(chat_conversations)")
    cc_cols = {row[1] for row in await cur.fetchall()}
    if "model" not in cc_cols:
        await db.execute("ALTER TABLE chat_conversations ADD COLUMN model TEXT")

    # anomalies: lap-relative location of the offending sample (T1.6)
    cur = await db.execute("PRAGMA table_info(anomalies)")
    a_cols = {row[1] for row in await cur.fetchall()}
    if "distance_pct" not in a_cols:
        await db.execute("ALTER TABLE anomalies ADD COLUMN distance_pct REAL")
    if "time_in_lap_ms" not in a_cols:
        await db.execute("ALTER TABLE anomalies ADD COLUMN time_in_lap_ms INTEGER")

    # laps: pit-in flag so pace stats can exclude in/out laps cleanly (T2.3)
    if "is_pit_lap" not in lcols:
        await db.execute("ALTER TABLE laps ADD COLUMN is_pit_lap INTEGER DEFAULT 0")

    # Per-lap fingerprint history (T2.4)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS lap_fingerprints (
            session_id TEXT NOT NULL,
            lap_num INTEGER NOT NULL,
            throttle_smoothness REAL,
            braking_aggressiveness REAL,
            max_brake REAL,
            steering_smoothness REAL,
            computed_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (session_id, lap_num),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Coaching points produced by backend/app/coaching.py (T2.1)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS coaching_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            lap_num INTEGER,
            sector_num INTEGER,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            computed_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_coaching_points_session "
        "ON coaching_points(session_id, lap_num, sector_num)"
    )

    # Auto-tags surfaced in session list (T2.6)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS session_tags (
            session_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (session_id, tag),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Coaching plan + focus items (T4.1)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS coaching_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS coaching_focus_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            item_text TEXT NOT NULL,
            target_metric TEXT,
            target_value REAL,
            status TEXT DEFAULT 'open',
            evaluation_json TEXT,
            FOREIGN KEY (plan_id) REFERENCES coaching_plans(id) ON DELETE CASCADE
        )"""
    )

    # Per-message feedback (T3.6 future eval)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS chat_feedback (
            message_id INTEGER PRIMARY KEY,
            rating INTEGER NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
        )"""
    )

    # Proactive nudges (T3.3)
    await db.execute(
        """CREATE TABLE IF NOT EXISTS proactive_nudges (
            session_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            dismissed_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Lap annotations — driver-authored notes anchored to a (session, lap,
    # distance_pct) tuple so the chart can overlay dots and the chat agent can
    # surface the notes in replies.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS lap_annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            lap_num INTEGER NOT NULL,
            distance_pct REAL,
            time_in_lap_ms INTEGER,
            author TEXT DEFAULT '',
            body TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_annotations_session "
        "ON lap_annotations(session_id, lap_num)"
    )

    # Proposals (Phase 8) — layout / math_channel proposals from the chat agent
    # that the user can Apply or Reject. Replaces the "[proposed] " prefix
    # convention on layouts and the user_settings:math_proposal:{id} hack.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            source TEXT NOT NULL DEFAULT 'chat',
            created_at TEXT DEFAULT (datetime('now')),
            applied_at TEXT,
            rejected_at TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_proposals_session_status "
        "ON proposals(session_id, status)"
    )

    # Persistent job queue (Phase 9) — replaces asyncio fire-and-forget for
    # narrative/plan/auto-title/backfill so work survives a server restart.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS job_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT,
            finished_at TEXT,
            error_message TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_job_runs_status "
        "ON job_runs(status, kind)"
    )
    # Crash safety — any job that claimed 'running' at shutdown can be reset
    # to 'pending' on the next startup so the worker picks it back up.
    await db.execute(
        "UPDATE job_runs SET status='pending' "
        "WHERE status='running' AND started_at < datetime('now','-5 minutes')"
    )

    # Share tokens (Phase 6) — read-only /share/sessions/[token] links for
    # sending to coaches without auth.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS share_tokens (
            token TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'session',
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            revoked_at TEXT,
            view_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )"""
    )

    # Reference laps (Phase 15) — first-class "this is my PB / benchmark" lap
    # keyed by (driver, venue). Used by the compare page, track-map delta
    # overlay, and the hero "vs PB: +0.42s" pill. ON DELETE SET NULL so that
    # deleting the backing session downgrades the reference to an orphan row
    # that the backfill re-runs on next startup.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS reference_laps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            lap_num INTEGER NOT NULL,
            driver TEXT DEFAULT '',
            venue TEXT DEFAULT '',
            name TEXT DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'user',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_reference_laps_driver_venue "
        "ON reference_laps(driver, venue)"
    )

    # Backfill drivers / vehicles from legacy sessions whose rows were written
    # before the upload pipeline auto-upserted driver_id / vehicle_id. Runs at
    # every startup; idempotent because of the LEFT JOIN check on NULL ids.
    await _backfill_driver_vehicle_ids(db)

    # Auto-seed one kind='pb' reference lap per (driver, venue). Idempotent:
    # only inserts if no 'pb' reference exists for that pair yet.
    try:
        await _backfill_pb_references(db)
    except Exception as e:
        print(f"[migration] PB reference backfill failed: {e}")

    # One-shot migration of legacy chat-agent proposals into the proposals
    # table. Idempotent — matches legacy rows by their distinct naming.
    try:
        await _migrate_proposals_one_shot(db)
    except Exception as e:
        print(f"[migration] proposals migration failed: {e}")


async def _backfill_pb_references(db: aiosqlite.Connection) -> None:
    """Seed reference_laps with one 'pb' row per (driver, venue).

    For each (driver, venue) pair represented in sessions, find the session+lap
    whose lap time is the minimum, and create a kind='pb' reference if one
    doesn't already exist. Makes the compare page + track-map delta overlay
    immediately meaningful on existing databases.
    """
    # Already-seeded pairs (driver, venue)
    cur = await db.execute(
        "SELECT driver, venue FROM reference_laps WHERE kind = 'pb'"
    )
    seeded = {(r[0] or "", r[1] or "") for r in await cur.fetchall()}

    # For every (driver, venue), pick the session with the lowest best_lap_time.
    cur = await db.execute(
        """SELECT driver, venue, id AS session_id, best_lap_time_ms
           FROM sessions
           WHERE best_lap_time_ms > 0
             AND driver IS NOT NULL AND TRIM(driver) != ''
             AND venue IS NOT NULL AND TRIM(venue) != ''"""
    )
    rows = [dict(r) for r in await cur.fetchall()]
    pb_by_pair: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["driver"].strip(), r["venue"].strip())
        if key in seeded:
            continue
        prev = pb_by_pair.get(key)
        if prev is None or r["best_lap_time_ms"] < prev["best_lap_time_ms"]:
            pb_by_pair[key] = r

    for (driver, venue), r in pb_by_pair.items():
        # Need the actual lap_num whose duration_ms == best_lap_time_ms.
        cur = await db.execute(
            """SELECT num FROM laps
               WHERE session_id = ? AND duration_ms = ? AND num > 0
               ORDER BY num LIMIT 1""",
            (r["session_id"], r["best_lap_time_ms"]),
        )
        lap_row = await cur.fetchone()
        if not lap_row:
            continue
        await db.execute(
            """INSERT INTO reference_laps
               (session_id, lap_num, driver, venue, name, kind, is_default)
               VALUES (?, ?, ?, ?, ?, 'pb', 1)""",
            (
                r["session_id"],
                int(lap_row[0]),
                driver,
                venue,
                f"PB · {driver} · {venue}",
            ),
        )


async def _migrate_proposals_one_shot(db: aiosqlite.Connection) -> None:
    """Move legacy [proposed] layouts and math_proposal user_settings into
    the proposals table. Idempotent — runs at every startup, but only acts on
    rows that haven't been migrated yet. Orphaned legacy rows whose session no
    longer exists are dropped silently (no FK violation).
    """
    import json as _json

    async def _session_exists(sid: str) -> bool:
        c = await db.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,))
        return (await c.fetchone()) is not None

    # Legacy layouts: name starts with "[proposed] "
    cur = await db.execute(
        "SELECT id, name, config_json FROM layouts WHERE name LIKE '[proposed]%'"
    )
    rows = await cur.fetchall()
    cols = await db.execute("PRAGMA table_info(layouts)")
    layout_cols = {r[1] for r in await cols.fetchall()}
    has_sid_col = "session_id" in layout_cols
    for row in rows:
        try:
            cfg = _json.loads(row["config_json"] or "null")
        except Exception:
            cfg = None
        sid: str | None = None
        if has_sid_col:
            cur2 = await db.execute(
                "SELECT session_id FROM layouts WHERE id = ?", (row["id"],)
            )
            r2 = await cur2.fetchone()
            sid = r2[0] if r2 else None
        if isinstance(cfg, dict) and sid and await _session_exists(sid):
            charts = cfg.get("charts") or []
            name = row["name"].replace("[proposed]", "", 1).strip() or "Legacy proposal"
            await db.execute(
                """INSERT INTO proposals (session_id, kind, payload_json, source, status)
                   VALUES (?, 'layout', ?, 'chat', 'pending')""",
                (sid, _json.dumps({"name": name, "charts": charts})),
            )
        # Drop the legacy layout row whether we migrated it or not.
        await db.execute("DELETE FROM layouts WHERE id = ?", (row["id"],))

    # Legacy user_settings math_proposal entries
    cur = await db.execute(
        "SELECT key, value FROM user_settings WHERE key LIKE 'math_proposal:%'"
    )
    ms_rows = await cur.fetchall()
    for r in ms_rows:
        try:
            items = _json.loads(r["value"] or "[]") or []
        except Exception:
            items = []
        sid = r["key"].split(":", 1)[1] if ":" in r["key"] else None
        if sid and await _session_exists(sid):
            for it in items:
                name = (it.get("name") or "").strip()[:60]
                formula = (it.get("expression") or it.get("formula") or "").strip()
                if not name or not formula:
                    continue
                await db.execute(
                    """INSERT INTO proposals (session_id, kind, payload_json, source, status)
                       VALUES (?, 'math_channel', ?, 'chat', 'pending')""",
                    (sid, _json.dumps({"name": name, "formula": formula, "units": ""})),
                )
        await db.execute("DELETE FROM user_settings WHERE key = ?", (r["key"],))


async def _backfill_driver_vehicle_ids(db: aiosqlite.Connection) -> None:
    """Populate sessions.driver_id / vehicle_id for rows missing the link."""
    # Drivers
    cur = await db.execute(
        "SELECT DISTINCT driver FROM sessions WHERE driver IS NOT NULL AND TRIM(driver) != '' AND driver_id IS NULL"
    )
    names = [row[0] for row in await cur.fetchall()]
    for name in names:
        name = name.strip()
        if not name:
            continue
        cur = await db.execute("SELECT id FROM drivers WHERE name = ?", (name,))
        row = await cur.fetchone()
        if row:
            did = int(row[0])
        else:
            cur = await db.execute("INSERT INTO drivers (name, weight_kg) VALUES (?, 0)", (name,))
            did = int(cur.lastrowid)
        await db.execute("UPDATE sessions SET driver_id = ? WHERE driver = ? AND driver_id IS NULL", (did, name))

    # Vehicles
    cur = await db.execute(
        "SELECT DISTINCT vehicle FROM sessions WHERE vehicle IS NOT NULL AND TRIM(vehicle) != '' AND vehicle_id IS NULL"
    )
    names = [row[0] for row in await cur.fetchall()]
    for name in names:
        name = name.strip()
        if not name:
            continue
        cur = await db.execute("SELECT id FROM vehicles WHERE name = ?", (name,))
        row = await cur.fetchone()
        if row:
            vid = int(row[0])
        else:
            cur = await db.execute("INSERT INTO vehicles (name, class, engine) VALUES (?, '', '')", (name,))
            vid = int(cur.lastrowid)
        await db.execute("UPDATE sessions SET vehicle_id = ? WHERE vehicle = ? AND vehicle_id IS NULL", (vid, name))


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)
    await _migrate(db)
    await db.commit()
    await db.close()
