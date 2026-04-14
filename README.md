# KartLab

KartLab is a two-service telemetry analysis app for AiM `.xrk` and `.xrz` files.

- `backend/`: FastAPI service that parses uploads with `libxrk`, stores metadata in SQLite, and caches channel data as Arrow IPC files.
- `frontend/`: Next.js app for browsing sessions, viewing lap summaries, and comparing telemetry overlays.
- `data/`: persisted SQLite database, original uploads, and Arrow cache files.

## Run

From the project root:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8001/api/health`

## Local Development

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

## Storage Layout

- `data/telemetry.db`: session, channel, and lap metadata.
- `data/xrk/`: original uploads stored by session ID.
- `data/cache/<session_id>/`: one Arrow file per channel plus cached session metadata.
