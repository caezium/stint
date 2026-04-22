# RaceStudio 3 ↔ Stint feature parity

First-pass inventory compiled from AiM's official RaceStudio 3 Analysis
documentation (see Sources at bottom). Purpose: identify which of RS3's
features Stint already covers, which are gaps, which to prioritize for a
karting-first product, and which to explicitly skip.

**Audience assumption:** amateur / club karter using an AiM MyChron with
GPS. Not a factory racer with IMUs, wheel-speed sensors, ECU CAN, brake
pressure, suspension pots, or SmartyCam HD video. This scopes out roughly
30–40% of RS3's feature surface as "not applicable."

## Status legend

- ✅ **Have** — Stint has a roughly equivalent feature
- 🟡 **Partial** — exists but is thinner than RS3's version
- ❌ **Gap** — not in Stint, in scope for karting
- ⏭️ **Skip** — not in scope (pro/car-specific, would dilute the karting focus)

## Priority legend

- **P0** — ship next; visible gap on the karting happy path
- **P1** — ship this quarter; improves serious users' workflows
- **P2** — backlog; nice to have once the core is tight
- **—** — not prioritized (skip)

---

## 1. Session database & management

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Sessions list with search | ✅ | — | Phase 2 recently added sticky toolbar, grid/list, tag chips |
| Smart Collections (auto-filtered groups) | ✅ | — | `smart_collections` table; already wired |
| Manual Collections (drag-drop groupings) | ❌ | P2 | RS3 supports drag-drop. Stint only has smart collections |
| Recent Sessions (last-30) auto-collection | 🟡 | P2 | Stint has date-desc sort; a "recent" collection chip would be trivial |
| Session Properties Editor (driver/vehicle/venue) | ✅ | — | `PUT /sessions/{id}/assign` + assignments in hero |
| Session metadata search (driver/vehicle/track/comments) | ✅ | — | Already in filter bar |
| Batch folder import | ✅ | — | Phase 1 multi-file upload shipped |
| Export sessions to `.drk` / CSV | 🟡 | P1 | Stint has CSV export per session; not batch |
| Session Preview panel (stats without opening) | 🟡 | P1 | Stint's cards show best-lap + tags; RS3 has mini-graph + channel table |
| Session-mode-specific previews (oval/drag/road) | ⏭️ | — | Karting-first = only one mode |
| Session duplicate detection on import | ❌ | P2 | Stint just overwrites on re-upload |
| AiM Cloud upload/sync | ⏭️ | — | Stint is local-first; replaced by share tokens (Phase 6) |

## 2. Session preview widgets

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Laps Summary preview (table + slider + max/min) | 🟡 | P1 | Session detail has lap table; no preview-on-hover |
| Laps Report preview (lap time vs distance graph) | 🟡 | P1 | Stint's card shows best lap + count, no graph |
| Map preview on hover | ❌ | P2 | Would need a lightweight track-map thumbnail |
| Weather preview | 🟡 | P2 | `session_log_sheets.weather` stored but not previewed on cards |
| Advanced session info (logger/file paths) | ✅ | — | Visible on detail page |

## 3. Layouts & panels

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Data-Movies layout (channels + map + graph + video + storyboard) | ⏭️ | — | No video ingestion in Stint |
| Time-Distance layout | ✅ | — | Analysis workspace is this layout by default |
| Track Map layout | ✅ | — | TrackMapLeaflet component |
| Split Times Report layout | 🟡 | **P0** | Compare page has sector splits; no dedicated all-laps × all-splits table on session detail |
| Channels Report layout (min/max/avg per lap or segment) | ❌ | **P0** | Stint's debrief has lap consistency but not per-channel aggregates by lap |
| Scatter layout (e.g. G-G diagram) | ❌ | P1 | Fun for kart analysis of lat-accel vs long-accel; modest build |
| Histogram layout (frequency of channel values) | ❌ | P1 | Useful for throttle/brake distribution analysis |
| Frequency Analysis layout (FFT) | ⏭️ | — | Almost always suspension-oriented; not karting |
| Suspension Analysis layout | ⏭️ | — | Karts don't have shocks on pots |
| Log Sheets layout (weather/setup/tire pressures) | ✅ | — | `LogSheetPanel` already on session detail |
| Custom user layouts (save/reuse) | 🟡 | P1 | Stint has `layouts` table + the chat-proposed layout flow; no first-class save-my-layout UX |
| Multi-monitor tab drag-out | ⏭️ | — | Desktop-app feature; web workspace is one browser window |

## 4. Charts & visualization (inside panels)

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Channel line plots in distance domain | ✅ | — | Workspace charts |
| Channel line plots in time domain | ✅ | — | Toggle already exists |
| Overlapped / mixed / tiled / smart plot modes | 🟡 | P1 | Stint supports multiple charts; no preset mode switcher |
| Per-channel colour, line width, dots | 🟡 | P2 | Colours are automatic; no per-chart customization UI |
| Custom zoom via drag-select | ✅ | — | Chart lib supports it |
| Snap mode (zoom-out snaps to single lap or full session) | ❌ | P1 | Useful keyboard/mouse nicety |
| Local time mode (keeps driver position sync across laps) | ❌ | P1 | Cross-lap cursor sync — hugely useful for coaching |
| Time-Compare graph (delta channel vs reference lap) | ✅ | — | `/compare` page delta-T chart shipped Phase 3 |
| Max / Min value markers on graphs | ❌ | P2 | Small UX polish |
| Cursor settings (size, crosshair) | 🟡 | P2 | Basic cursor exists; no size option |
| Channel tags (live values + stats overlay) | 🟡 | P2 | Tooltips show values; no pinned-overlay stats |
| Graph settings dialog (right-click) | 🟡 | P2 | Some right-click context menu exists |

## 5. Split / sector management

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Define splits on track edit page | ✅ | — | 1-click perpendicular + 2-click manual |
| Merge / divide / rename / retype splits | 🟡 | P2 | Only add/delete today |
| Best Theoretical Time (sum of best sectors) | ✅ | — | Already computed in debrief |
| Best Rolling Time (real achieved) | ❌ | P1 | Distinct from theoretical; small addition on top of lap times |
| Split Details panel (per-segment traces + scatter) | ❌ | P1 | Meaningful for "where am I losing it" questions |
| Split Report table (all laps × all splits) | ❌ | **P0** | Common karting workflow; small build |
| Split Duplication across sessions | ⏭️ | — | Stint binds splits to tracks (one per venue), so duplication is automatic |

## 6. Track map

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| GPS driven-line on map | ✅ | — | Leaflet map on session detail |
| Web tile providers (OSM, satellite) | ✅ | — | Leaflet defaults |
| Offline / GDI map rendering | ⏭️ | — | Web app; always online |
| Colour line by channel value (speed, RPM, brake) | 🟡 | P1 | Speed colouring only; extend to any channel |
| Colour line by time-compare (delta vs reference) | ❌ | **P0** | Killer feature for identifying where time is lost — adds a lot of signal for little cost |
| Colour line by GPS altitude | ⏭️ | — | Flat karting tracks, little value |
| Vehicle position animation across laps | ❌ | P2 | Nice for teaching; tricky with multiple laps |
| Map zoom / pan independent of chart | ✅ | — | Leaflet gives this |
| Pit-lane definition editor | ✅ | — | Track edit page |

## 7. Video / SmartyCam

All ⏭️ for now. Karting-first means no SmartyCam integration, MP4 cut,
video-graph sync, frame-accurate cursor. Might revisit if users record with
phones/GoPros.

## 8. Math channels

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Built-in math channel library (GPS derivatives, power estimate, gear, slip) | ✅ | — | `DEFAULT_MATH_CHANNELS` covers the GPS + common karting ones |
| Custom math channel formula editor | ✅ | — | `/api/math_channels` + formula validator |
| Logical / arithmetic / statistical / trimming functions | ✅ | — | `_safe_eval_formula` supports AST-whitelisted ops |
| Filtering functions (FIR, EMA, ROLL_AVG, MEDIAN) | 🟡 | P2 | Stint supports basic arithmetic; not FIR/EMA |
| Timing functions (LAPTIME, SESSIONTIME, TIME_SHIFT) | 🟡 | P1 | Stint's distance/time channels are implicit; no user-callable time functions |
| Bike-specific (BIKE_ANGLE, BIKE_ACCLAT) | ⏭️ | — | Not karting |
| Understeer Warning (UWA) | ❌ | P2 | Could compute from yaw / speed; small |
| FMI limiter simulation | ⏭️ | — | |
| LookUp Tables 2D/3D | ❌ | P2 | Useful but non-trivial |
| DLL / external library plugin | ⏭️ | — | Web app, can't load native DLLs |
| Channel aliases across loggers | ❌ | P2 | Important if user has multiple loggers; rare for single-kart driver |
| Formula verify before commit | ✅ | — | AST validation already gives immediate errors |
| Recompute all laps after formula change | 🟡 | P2 | Stint recomputes on upload, not on formula edit |

## 9. Reports & export

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Data Tech Reports (stats per lap / per segment) | ❌ | **P0** | Stint only has debrief narrative; a channels-report table is a top gap |
| Report Builder (pick channels, stats, filter) | 🟡 | P1 | Layouts panel is partial equivalent |
| Box plots across laps | ❌ | P2 | Good for consistency coaching |
| Normal distribution overlay on histogram | ❌ | P2 | Needs histogram first |
| Printable / PDF export of report | 🟡 | P1 | `getExportPdfUrl` exists for whole session; no custom report export |
| CSV export per session | ✅ | — | Already in ActionRail |
| CSV export batch (multiple sessions) | ❌ | P2 | |
| Report templates save/import | ❌ | P2 | |
| Magic-wand report suggestions | ⏭️ | — | Chat agent already does this better |

## 10. Reference laps / predictive

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Generate predictive reference lap from a recorded lap | ❌ | **P0** | Karters love this — "am I ahead or behind my PB right now" |
| Reference lap file management | ❌ | **P0** | Stint has PB via `session_tags` but no dedicated "reference lap" object |
| Transmit reference lap to AiM device over USB | ⏭️ | — | Out of web-app scope (would need native bridge) |
| Reference-lap-based delta during live upload (predictive timer UX) | ❌ | P1 | Deferred until predictive lap object exists |
| Time-compare against reference (already possible via /compare) | ✅ | — | Just needs the reference lap abstraction |

## 11. Channel management

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Channel settings dialog (units, decimals, sampling) | 🟡 | P1 | Units via Settings page is global; no per-channel override |
| Channel alarm thresholds (min/max, between-range) | ❌ | P1 | Anomaly watchdog is the closest equivalent; but user-configurable thresholds are a gap |
| Channel correction / override values | ⏭️ | — | Risky without audit; skip unless requested |
| Channel filtering at display time | 🟡 | P2 | Math channels are the escape hatch |
| Channel source attribution (GPS/CAN/analog/calc) | 🟡 | P2 | `channels.category` covers some of this |
| Channel search / order / custom sort | ✅ | — | Workspace channel picker has search |
| Channel comments / notes | ❌ | P2 | Unusual use case |
| Per-channel colour picker | 🟡 | P2 | Colours auto-assigned; no per-channel override |

## 12. Analysis profiles

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Save named profile (layouts + settings) | 🟡 | P1 | `layouts` table + localStorage partial; no first-class profile UI |
| Load / switch between profiles | ❌ | P1 | |
| Profile per-user / per-device sync | ⏭️ | — | Local-first; not in scope |
| Default quick-start profile | ✅ | — | Stint's default analysis workspace is this |

## 13. Advanced analysis

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| G-G diagram (lat vs long accel scatter) | ❌ | P1 | Blocked on "Scatter layout" (sec 3) |
| FFT frequency analysis | ⏭️ | — | |
| Understeer warning | ❌ | P2 | Karting cornering analysis nicety |
| Slip ratio calculation | ⏭️ | — | Needs wheel-speed sensors |
| Gear detection | 🟡 | P2 | Karts with shifter kits only |
| Brake pressure analysis | ⏭️ | — | Karts rarely have brake pressure sensors |
| Throttle angle statistics (aggression / smoothness) | ✅ | — | `driving_fingerprint` has throttle_smoothness |
| Steering angle trends | ⏭️ | — | No steering sensor on most karts |
| Corner detection (auto-identify high-lat-g zones) | 🟡 | P1 | Stint's sector system is a manual equivalent |
| Driving fingerprint radar / history | ✅ | — | Debrief fingerprint + history chart shipped |
| Anomaly watchdog (mechanical/sensor faults) | ✅ | — | Stint's detectors; karting-tuned (Phase 0) |

## 14. Metadata

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Weather log (air temp, track temp, humidity, wind) | ✅ | — | Log sheet panel |
| Weather from API (historical via OpenWeather) | 🟡 | P2 | Log sheet takes manual input; no auto-fetch |
| Engine telemetry (RPM, oil, coolant, battery) | 🟡 | — | Surfaced via anomaly watchdog + chart channels when logger provides them |
| Vehicle setup (gear, suspension, brake bias, aero) | 🟡 | P2 | Partially in log sheet; no structured setup sheet |
| Fuel consumption tracking | 🟡 | P2 | Log sheet captures start fuel; no per-lap trend |
| Free-text notes / comments | ✅ | — | Session notes + new lap annotations (Phase 4) |

## 15. Cloud / collaboration

| Feature | Stint | Priority | Notes |
|---|---|---|---|
| Cloud upload / backup | ⏭️ | — | Local-first; AiM's cloud is subscription-only and we're not that |
| Share session with coach | ✅ | — | Phase 6 share tokens + public `/share/sessions/[token]` |
| Profile sync across PCs | ⏭️ | — | |
| Historical weather from cloud | 🟡 | P2 | |

---

## Priority roadmap — the "next 10 features"

Synthesizing the **P0**s and compelling **P1**s above into a ranked backlog:

1. **Time-compare colour on track map** — paint the driven line by delta-t
   vs reference lap. One of the top visual insights in RS3. Small build
   (reuse `/compare/delta-t` + track map). Probably the single highest
   signal-per-effort item.
2. **Split Report table** — all laps × all splits in one table with cell
   colouring, best-in-column highlighted, theoretical/rolling best rows.
   Standard karting debrief view.
3. **Channels Report table** — per-lap min/max/avg/p90 for selected channels.
   The data is already in the Arrow cache; just needs a table UI + backend
   aggregator.
4. **Predictive reference lap object** — first-class "this is my reference"
   abstraction (DB row, dashboard widget, used by compare). Unlocks
   coach-facing "where would I be right now vs my PB" experiences.
5. **Local-time mode on charts** — cursor synchronization across multiple
   laps so coaches can see the same point on every lap simultaneously.
6. **Histogram layout** — throttle%, brake%, RPM distribution per lap, with
   secondary-channel colouring (like RS3's recent release). Pairs well with
   driving fingerprint.
7. **Scatter layout / G-G diagram** — lateral vs longitudinal accel for
   traction circle analysis. Karting-friendly if you have the accel channel.
8. **Save-my-layout UX** — promote the existing `layouts` table into a
   first-class "profile" picker so users can preserve workspace setups.
9. **Snap mode + max/min markers** — minor graph affordances; small build,
   noticeable polish.
10. **Custom alarm thresholds** — let users set their own min/max alerts
    per channel, surfacing through the anomaly watchdog.

## Explicit non-goals (karting scope)

The following RS3 features are **not** planned for Stint unless a user
explicitly requests them. Documenting so we don't accidentally pick them up:

- Suspension analysis layout, FFT / frequency analysis
- SmartyCam integration (any video ingestion / MP4 cut / data-video sync)
- AiM Cloud upload and profile sync (Stint is local-first)
- Bike-specific math channels (BIKE_ANGLE, BIKE_ACCLAT, BIKE_CORNRAD)
- Brake pressure, slip ratio, steering angle analysis (most karts lack the
  sensors)
- DLL / native plugin extensibility
- Multi-monitor tab drag-out
- Transmitting reference laps over USB to the AiM device (would need a
  native companion app)

## What Stint has that RS3 doesn't

For completeness — places we're already ahead of RS3 (at least from the
docs; real-world users may disagree):

- **Chat agent with tool use** — natural-language Q&A grounded in the
  session data. RS3 has a "magic wand" report suggestion but no
  conversational coach.
- **Auto-generated narrative debrief + coaching plan** — LLM-written
  summary with measurable target items carried session-to-session.
- **Lap annotations referenced by the chat agent** — "lost the front in
  T3" becomes context the coach actually reads.
- **Anomaly watchdog** — tuned for karting (Phase 0) with pit-lap, voltage,
  RPM dropout detectors.
- **Share links** — one-click read-only URL for sending to a coach, no auth
  required.
- **Tag auto-classification** — personal-best / clean / inconsistent /
  mechanical-concerns auto-applied.
- **Pre-session brief** — venue-specific PB + recent sessions + open
  coaching items for next outing.

## Sources

- [RaceStudio 3 Analysis — official manual](https://www.aim-sportline.com/docs/racestudio3/manual/html/analysis.html)
- [RaceStudio 3 User Manual index](https://www.aim-sportline.com/docs/racestudio3/manual/html/index.html)
- [Tracks for Analysis and Devices](https://www.aim-sportline.com/docs/racestudio3/manual/html/tracks.html)
- [Racer Utilities](https://www.aim-sportline.com/docs/racestudio3/manual/html/racer-utilities.html)
- [What's New in RaceStudio 3](https://www.aim-sportline.com/docs/racestudio3/html/release/what-s-new-release.html)
- [Full PDF (latest)](https://www.aim-sportline.com/docs/racestudio3/manual/latex/racestudio3-manual-en-latest.pdf)
- [RaceStudio 3 Analysis Release 1.00 PDF (dedicated)](https://www.aim-sportline.com/aim-software-betas/Software/Docs/RSA3_100_eng_20210510_1110.pdf)

## Next step

This doc is a first pass from the official manual. To refine:

1. **Live tour** — run RS3 on your Mac and have me screenshot the actual
   UI. The manual undersells several panels (e.g. I suspect the Split
   Report table is richer than the docs describe).
2. **Short interview** — for each P0, we write a concrete Stint issue:
   what's the smallest surface the user will recognize as "this is the RS3
   thing I wanted"?
3. **File GitHub issues for P0s** — turn the priority list into actionable
   tickets with acceptance criteria.
