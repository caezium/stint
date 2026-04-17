"""File upload endpoint."""

from fastapi import APIRouter, UploadFile, HTTPException
from ..database import get_db
from ..xrk_service import parse_and_cache

router = APIRouter()

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


async def persist_session(db, result: dict) -> None:
    """Upsert a parsed session and replace its child metadata atomically."""
    await db.execute(
        """INSERT INTO sessions
           (id, file_name, driver, vehicle, venue, log_date, log_time,
            session_name, series, logger_model, logger_id,
            lap_count, best_lap_time_ms, total_duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             file_name = excluded.file_name,
             driver = excluded.driver,
             vehicle = excluded.vehicle,
             venue = excluded.venue,
             log_date = excluded.log_date,
             log_time = excluded.log_time,
             session_name = excluded.session_name,
             series = excluded.series,
             logger_model = excluded.logger_model,
             logger_id = excluded.logger_id,
             lap_count = excluded.lap_count,
             best_lap_time_ms = excluded.best_lap_time_ms,
             total_duration_ms = excluded.total_duration_ms""",
        (result["session_id"], result.get("file_name", ""),
         result.get("driver", ""), result.get("vehicle", ""),
         result.get("venue", ""), result.get("log_date", ""),
         result.get("log_time", ""), result.get("session_name", ""),
         result.get("series", ""), result.get("logger_model", ""),
         result.get("logger_id", 0), result.get("lap_count", 0),
         result.get("best_lap_time_ms", 0), result.get("total_duration_ms", 0))
    )

    # Refresh child rows so cache/schema updates do not leave stale records behind.
    await db.execute("DELETE FROM channels WHERE session_id = ?", (result["session_id"],))
    await db.execute("DELETE FROM laps WHERE session_id = ?", (result["session_id"],))

    await db.executemany(
        """INSERT INTO channels
           (session_id, name, units, dec_pts, sample_count, interpolate, function_name, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                result["session_id"],
                ch["name"],
                ch["units"],
                ch["dec_pts"],
                ch["sample_count"],
                ch["interpolate"],
                ch["function_name"],
                ch["category"],
            )
            for ch in result.get("channels", [])
        ],
    )

    await db.executemany(
        """INSERT INTO laps
           (session_id, num, start_time_ms, end_time_ms, duration_ms)
           VALUES (?, ?, ?, ?, ?)""",
        [
            (
                result["session_id"],
                lap["num"],
                lap["start_time_ms"],
                lap["end_time_ms"],
                lap["duration_ms"],
            )
            for lap in result.get("laps", [])
        ],
    )


@router.post("/upload")
async def upload_file(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = file.filename.lower().split(".")[-1]
    if ext not in ("xrk", "xrz"):
        raise HTTPException(400, f"Unsupported file type: .{ext}. Upload .xrk or .xrz files.")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Empty file")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large. Maximum upload size is 100 MB.")

    try:
        result = parse_and_cache(content, file.filename)
    except Exception as e:
        raise HTTPException(500, f"Failed to parse file: {str(e)}")

    # Apply session naming template if configured
    try:
        from .settings import get_setting_value
        tmpl = await get_setting_value("session_naming_template", "")
        if tmpl:
            tokens = {
                "{driver}": result.get("driver", ""),
                "{vehicle}": result.get("vehicle", ""),
                "{track}": result.get("venue", ""),
                "{date}": result.get("log_date", ""),
                "{time}": result.get("log_time", ""),
            }
            rendered = tmpl
            ok = True
            for k, v in tokens.items():
                if k in rendered and not v:
                    ok = False
                    break
                rendered = rendered.replace(k, v)
            if ok and rendered.strip():
                result["session_name"] = rendered
    except Exception:
        pass

    # Insert into database
    db = await get_db()
    try:
        await persist_session(db, result)
        await db.commit()
    finally:
        await db.close()

    # Run anomaly detection. Non-fatal: upload must succeed even if detection fails.
    try:
        from ..anomalies import detect_session_anomalies
        await detect_session_anomalies(result["session_id"])
    except Exception as e:
        # Swallow — anomalies are an additive signal, not core upload data.
        print(f"[anomalies] detection failed for {result['session_id']}: {e}")

    # Generate auto-debrief. Non-fatal.
    try:
        from ..debrief import generate_debrief
        await generate_debrief(result["session_id"])
    except Exception as e:
        print(f"[debrief] generation failed for {result['session_id']}: {e}")

    # Compute coaching points (T2.1). Non-fatal.
    try:
        from ..coaching import compute_session_coaching_points
        await compute_session_coaching_points(result["session_id"])
    except Exception as e:
        print(f"[coaching] computation failed for {result['session_id']}: {e}")

    # T4.1: evaluate the prior session's plan, then generate a new one. Both
    # are best-effort and require an OpenRouter key to actually emit items.
    try:
        from ..plans import evaluate_prior_plan, generate_plan
        await evaluate_prior_plan(result["session_id"])
        await generate_plan(result["session_id"])
    except Exception as e:
        print(f"[plans] generation failed for {result['session_id']}: {e}")

    # Auto-tag session (T2.6). Non-fatal.
    try:
        from ..tags import compute_session_tags
        await compute_session_tags(result["session_id"])
    except Exception as e:
        print(f"[tags] computation failed for {result['session_id']}: {e}")

    # Build proactive nudge (T3.3). Non-fatal.
    try:
        from .chat_assist import maybe_create_nudge
        await maybe_create_nudge(result["session_id"])
    except Exception as e:
        print(f"[nudge] creation failed for {result['session_id']}: {e}")

    # Try to auto-match a track and, if it has an S/F line, apply it immediately.
    auto_track_applied = None
    try:
        gps_outline = result.get("gps_outline") or []
        if not gps_outline:
            # Derive downsampled outline from GPS arrow files
            try:
                from ..routers.channels import _find_arrow_file as _faf
                import pyarrow.ipc as _ipc
                lp = _faf(result["session_id"], "GPS Latitude") or _faf(result["session_id"], "GPS_Latitude")
                op = _faf(result["session_id"], "GPS Longitude") or _faf(result["session_id"], "GPS_Longitude")
                if lp and op:
                    lats = _ipc.open_file(lp).read_all().column(1).to_pylist()
                    lons = _ipc.open_file(op).read_all().column(1).to_pylist()
                    step = max(1, len(lats)//200)
                    gps_outline = [[lats[i], lons[i]] for i in range(0, len(lats), step)]
            except Exception:
                gps_outline = []
        if gps_outline:
            import json as _json
            db = await get_db()
            try:
                cur = await db.execute(
                    "SELECT id, name, length_m, gps_outline_json, sf_line_json FROM tracks"
                )
                rows = await cur.fetchall()
            finally:
                await db.close()
            # Centroid-based match (inline to avoid circular import)
            import math as _math
            def _centroid(pts):
                if not pts:
                    return None
                sx = sum(p[0] for p in pts)
                sy = sum(p[1] for p in pts)
                return (sx/len(pts), sy/len(pts))
            c0 = _centroid(gps_outline)
            best = None
            best_d = float("inf")
            if c0:
                for r in rows:
                    outl = _json.loads(r["gps_outline_json"] or "[]")
                    c = _centroid(outl)
                    if not c:
                        continue
                    mlat = (c0[0]+c[0])/2
                    dx = (c[0]-c0[0])*111320.0
                    dy = (c[1]-c0[1])*111320.0*max(0.01, _math.cos(_math.radians(mlat)))
                    d = _math.hypot(dx, dy)
                    if d < best_d:
                        best_d = d
                        best = r
            if best and best_d < 500 and (best["sf_line_json"] or ""):
                from .tracks import recompute_session_from_track
                try:
                    await recompute_session_from_track(result["session_id"], int(best["id"]))
                    auto_track_applied = {"track_id": int(best["id"]), "track_name": best["name"]}
                except Exception:
                    pass
            elif (not best) or (best_d >= 500):
                # No nearby existing track — auto-create a new one so user can
                # drop an S/F line without needing to bootstrap the track row.
                try:
                    # Approximate outline length in meters (sum of segment lengths).
                    length_m: float | None = None
                    if len(gps_outline) >= 2:
                        total = 0.0
                        for i in range(1, len(gps_outline)):
                            la1, lo1 = gps_outline[i - 1]
                            la2, lo2 = gps_outline[i]
                            mlat = (la1 + la2) / 2.0
                            dx = (lo2 - lo1) * 111320.0 * max(0.01, _math.cos(_math.radians(mlat)))
                            dy = (la2 - la1) * 111320.0
                            total += _math.hypot(dx, dy)
                        length_m = total
                    track_name = (result.get("venue") or "").strip() or "Unnamed track"
                    db = await get_db()
                    try:
                        cur = await db.execute(
                            """INSERT INTO tracks
                               (name, country, length_m, gps_outline_json, sector_defs_json,
                                short_name, city, type, surface, timezone,
                                sf_line_json, split_lines_json, pit_lane_json)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                track_name, "", length_m if length_m is not None else 0,
                                _json.dumps(gps_outline), _json.dumps([]),
                                "", "", "", "", "",
                                "", _json.dumps([]), _json.dumps([]),
                            ),
                        )
                        new_track_id = cur.lastrowid
                        await db.execute(
                            "UPDATE sessions SET track_id = ? WHERE id = ?",
                            (new_track_id, result["session_id"]),
                        )
                        await db.commit()
                        auto_track_applied = {
                            "track_id": int(new_track_id),
                            "track_name": track_name,
                            "created": True,
                        }
                    finally:
                        await db.close()
                except Exception:
                    pass
    except Exception:
        pass

    return {
        "session_id": result["session_id"],
        "driver": result.get("driver", ""),
        "venue": result.get("venue", ""),
        "lap_count": result.get("lap_count", 0),
        "channel_count": len(result.get("channels", [])),
        "auto_track_applied": auto_track_applied,
    }
