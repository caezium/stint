# Stint

Racing telemetry analysis for AiM `.xrk` / `.xrz` log files. Upload a session, browse laps, compare overlays, dig into corners and channels, and let an AI coach surface what changed.

- **`backend/`** — FastAPI service. Parses uploads with `libxrk`, stores metadata in SQLite, caches channel data as Arrow IPC, and runs anomaly / debrief / coaching pipelines.
- **`frontend/`** — Next.js app. Sessions browser, lap analysis workspace, compare page, track maps, reports, chat.
- **`data/`** — persisted SQLite database, original uploads, and per-session Arrow cache.

## Features

**Sessions & laps**
- Multi-file upload, duplicate detection, soft-delete trash, manual collections, tag chips
- Driver and vehicle aggregates, sticky filters, grid/list views
- Hover-preview popovers, sparklines, benchmark bars

**Analysis workspace**
- Lap overlays with snap-to-cursor, distance-mode cursor, live tags, local-time toggle
- Reference laps as first-class citizens
- Histogram and scatter views, G-G diagram preset (matches AiM `GPS_*Acc` channels)
- Math channels with timing and filter functions, on-demand recompute
- Channel alarms, per-channel settings, profile export/import

**Tracks & corners**
- Track maps with satellite tiles and GPS offset calibration (Leaflet)
- Splits/sectors editor — label, type, merge, copy, up to 8 per track
- Auto-detected corners with apex, labels, per-lap timestamps, click-to-highlight on map

**Reports**
- Split Report and Channels Report tables
- Report Builder with templates, PDF export, batch zip

**AI (OpenRouter)**
- Anomaly watchdog — karting-tuned detectors flag unusual laps on upload
- Auto-debrief narrative + coaching plan, with cross-session memory
- Chat agent with chart right-click, evidence links, proposal cards (AI SDK v5)
- Pre-session brief and shareable coach links

**Other**
- Weather auto-fetch from log time (Open-Meteo)
- Persistent job queue with backfill progress
- Driver dashboard, dedicated `/chat` page, mobile drawer

## Run with Docker

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8001/api/health`

## Local development

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend:

```bash
cd backend
python3 -m venv ../.venv-backend
source ../.venv-backend/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## Verification

Frontend:

```bash
cd frontend
npm run lint
npm run test
npm run build
```

Backend:

```bash
./.venv-backend/bin/python -m unittest discover -s backend/tests
```

## Storage layout

- `data/telemetry.db` — sessions, channels, laps, corners, splits, anomalies, drivers, collections.
- `data/xrk/` — original uploads keyed by session ID.
- `data/cache/<session_id>/` — one Arrow file per channel plus cached session metadata.

## Docs

- `docs/racestudio-parity.md` — RaceStudio 3 feature parity matrix and karting priority roadmap.
