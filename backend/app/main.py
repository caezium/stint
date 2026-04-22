"""FastAPI application for Stint racing telemetry."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import (
    upload, sessions, channels, sectors, math_channels, layouts, profiles,
    export, compare, tracks, math_defaults, log_sheets, collections, reports, settings,
    admin, anomalies, debrief, chat, chat_assist, drivers,
    annotations, proposals, jobs, share, reference_laps, alarms,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from . import jobs as _jobs
    _jobs.start_worker()
    try:
        yield
    finally:
        await _jobs.stop_worker()


app = FastAPI(title="Stint", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(channels.router, prefix="/api")
app.include_router(sectors.router, prefix="/api")
app.include_router(math_channels.router, prefix="/api")
app.include_router(layouts.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(compare.router, prefix="/api")
app.include_router(tracks.router, prefix="/api")
app.include_router(math_defaults.router, prefix="/api")
app.include_router(log_sheets.router, prefix="/api")
app.include_router(collections.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(anomalies.router, prefix="/api")
app.include_router(debrief.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(chat_assist.router, prefix="/api")
app.include_router(drivers.router, prefix="/api")
app.include_router(annotations.router, prefix="/api")
app.include_router(proposals.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(share.router, prefix="/api")
app.include_router(reference_laps.router, prefix="/api")
app.include_router(alarms.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "stint"}
