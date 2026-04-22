import { decodeArrowIPC, type ResampledData } from "./arrow-decode";
import { DEFAULT_MATH_CHANNELS } from "./constants";

const DEFAULT_MATH_NAMES = new Set(DEFAULT_MATH_CHANNELS.map((c) => c.name));

// ---- Types ----

export interface Session {
  id: string;
  file_name: string;
  driver: string;
  vehicle: string;
  venue: string;
  log_date: string;
  log_time: string;
  session_name: string;
  series: string;
  logger_model: string;
  logger_id: number;
  lap_count: number;
  best_lap_time_ms: number | null;
  total_duration_ms: number | null;
  created_at: string;
  driver_id?: number | null;
  vehicle_id?: number | null;
  track_id?: number | null;
  /** Present only when list fetched with includeTags=true. */
  tags?: string[];
}

export interface Lap {
  num: number;
  start_time_ms: number;
  end_time_ms: number;
  duration_ms: number;
  split_times?: (number | null)[];
  is_pit_lap?: number | boolean | null;
}

export interface Channel {
  name: string;
  units: string;
  dec_pts: number;
  sample_count: number;
  interpolate: boolean;
  function_name: string;
  category: string;
}

export interface SessionDetail extends Session {
  laps: Lap[];
  channels: Channel[];
}

export interface TrackData {
  lat: number[];
  lon: number[];
  speed: number[];
  timecodes: number[] | null;
  point_count: number;
}

export interface UploadResult {
  session_id: string;
  driver: string;
  venue: string;
  lap_count: number;
  channel_count: number;
}

// ---- API functions ----

export async function fetchSessions(opts?: { includeTags?: boolean }): Promise<Session[]> {
  const url = opts?.includeTags ? "/api/sessions?include_tags=1" : "/api/sessions";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json();
}

// ---- Lap annotations ----

export interface LapAnnotation {
  id: number;
  session_id: string;
  lap_num: number;
  distance_pct: number | null;
  time_in_lap_ms: number | null;
  author: string;
  body: string;
  created_at: string;
}

export async function fetchAnnotations(sessionId: string): Promise<LapAnnotation[]> {
  const res = await fetch(`/api/sessions/${sessionId}/annotations`);
  if (!res.ok) throw new Error(`Failed to fetch annotations: ${res.status}`);
  return res.json();
}

export async function createAnnotation(
  sessionId: string,
  body: {
    lap_num: number;
    distance_pct?: number | null;
    time_in_lap_ms?: number | null;
    author?: string;
    body: string;
  }
): Promise<LapAnnotation> {
  const res = await fetch(`/api/sessions/${sessionId}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create annotation: ${res.status}`);
  return res.json();
}

export async function deleteAnnotation(id: number): Promise<void> {
  const res = await fetch(`/api/annotations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete annotation: ${res.status}`);
}

// ---- Proposals ----

export interface Proposal {
  id: number;
  session_id: string;
  kind: "layout" | "math_channel";
  payload: unknown;
  status: "pending" | "applied" | "rejected";
  source: string;
  created_at: string;
  applied_at: string | null;
  rejected_at: string | null;
}

export async function fetchProposals(sessionId: string, status: string = "pending"): Promise<Proposal[]> {
  const res = await fetch(`/api/sessions/${sessionId}/proposals?status=${status}`);
  if (!res.ok) throw new Error(`Failed to fetch proposals: ${res.status}`);
  return res.json();
}

export async function applyProposal(id: number): Promise<void> {
  const res = await fetch(`/api/proposals/${id}/apply`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to apply: ${res.status}`);
}

export async function rejectProposal(id: number): Promise<void> {
  const res = await fetch(`/api/proposals/${id}/reject`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to reject: ${res.status}`);
}

// ---- Jobs ----

export interface JobRun {
  id: number;
  session_id: string | null;
  kind: string;
  status: "pending" | "running" | "ok" | "error";
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  attempt: number;
  created_at: string;
}

export async function fetchJobs(params: {
  session_id?: string;
  kind?: string;
  status?: string;
}): Promise<JobRun[]> {
  const q = new URLSearchParams();
  if (params.session_id) q.set("session_id", params.session_id);
  if (params.kind) q.set("kind", params.kind);
  if (params.status) q.set("status", params.status);
  const res = await fetch(`/api/jobs?${q.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`);
  return res.json();
}

export async function enqueueJob(kind: string, sessionId?: string): Promise<{ id: number }> {
  const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  const res = await fetch(`/api/jobs/${kind}${q}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to enqueue: ${res.status}`);
  return res.json();
}

// ---- Share ----

export interface ShareToken {
  token: string;
  scope: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
}

export async function createShare(sessionId: string): Promise<{ token: string; url: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/share`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create share: ${res.status}`);
  return res.json();
}

export async function fetchShares(sessionId: string): Promise<ShareToken[]> {
  const res = await fetch(`/api/sessions/${sessionId}/shares`);
  if (!res.ok) throw new Error(`Failed to fetch shares: ${res.status}`);
  return res.json();
}

export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`/api/shares/${token}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to revoke share: ${res.status}`);
}

export async function fetchSharedSession(token: string): Promise<{
  session: Session;
  laps: Lap[];
  read_only: boolean;
}> {
  const res = await fetch(`/api/share/${token}`);
  if (!res.ok) throw new Error(`Failed to fetch share: ${res.status}`);
  return res.json();
}

export async function fetchSession(id: number | string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}?_t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch session ${id}: ${res.status}`);
  return res.json();
}

export async function fetchTrack(
  id: number | string,
  lap?: number
): Promise<TrackData> {
  const url = lap != null
    ? `/api/sessions/${id}/track?lap=${lap}`
    : `/api/sessions/${id}/track`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch track data: ${res.status}`);
  return res.json();
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Upload failed");
    throw new Error(text);
  }
  return res.json();
}

export async function deleteSession(id: number | string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete session ${id}: ${res.status}`);
}

export interface ChannelData {
  timecodes: number[];
  values: number[];
}

export async function fetchChannelData(
  sessionId: number | string,
  channelName: string,
  lap?: number
): Promise<ChannelData> {
  const params = new URLSearchParams({ format: "json" });
  if (lap !== undefined) params.set("lap", String(lap));
  const res = await fetch(
    `/api/sessions/${sessionId}/channels/${encodeURIComponent(channelName)}?${params}`
  );
  if (!res.ok)
    throw new Error(`Failed to fetch channel ${channelName}: ${res.status}`);
  const json = await res.json();
  return {
    timecodes: json.timecodes ?? [],
    values: json[channelName] ?? [],
  };
}

// ---- Resampled data (Arrow IPC) ----

export { type ResampledData } from "./arrow-decode";

/**
 * Fetch multiple channels for a single lap, resampled to a common timebase.
 * Returns dense typed arrays — no null gaps.
 */
export async function fetchResampledData(
  sessionId: string,
  channels: string[],
  lap: number,
  refChannel?: string
): Promise<ResampledData> {
  // Split into real channels vs default-math virtual channels
  const defaults = channels.filter((c) => DEFAULT_MATH_NAMES.has(c));
  const real = channels.filter((c) => !DEFAULT_MATH_NAMES.has(c));

  // Fetch both in parallel when we have defaults
  const realPromise: Promise<ResampledData | null> = real.length > 0
    ? (async () => {
        const params = new URLSearchParams({
          channels: real.join(","),
          lap: String(lap),
        });
        if (refChannel) params.set("ref_channel", refChannel);
        const res = await fetch(`/api/sessions/${sessionId}/resampled?${params}`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(
            `Failed to fetch resampled data: ${res.status} ${await res.text().catch(() => "")}`
          );
        }
        const buffer = await res.arrayBuffer();
        return decodeArrowIPC(buffer);
      })()
    : Promise.resolve(null);

  const mathPromise: Promise<Record<string, number[]> | null> = defaults.length > 0
    ? fetchMathDefaults(sessionId, lap).catch(() => null)
    : Promise.resolve(null);

  const [realData, mathData] = await Promise.all([realPromise, mathPromise]);

  if (realData && !mathData) return realData;

  if (!realData && mathData) {
    const tc = (mathData.timecodes ?? []) as number[];
    const rowCount = tc.length;
    const out: ResampledData = {
      timecodes: Float64Array.from(tc),
      channels: {},
      rowCount,
    };
    for (const name of defaults) {
      const arr = mathData[name];
      if (Array.isArray(arr)) {
        out.channels[name] = Float64Array.from(arr);
      }
    }
    return out;
  }

  if (realData && mathData) {
    // Merge math defaults into real data. Math defaults use lap-relative tc; real uses absolute.
    // Interpolate math arrays onto real timecodes using lap-relative offset.
    const realTc = realData.timecodes;
    const n = realData.rowCount;
    if (n === 0) return realData;
    const startMs = realTc[0];
    const mathTc = (mathData.timecodes ?? []) as number[];
    const merged: ResampledData = {
      timecodes: realTc,
      channels: { ...realData.channels },
      rowCount: n,
    };
    for (const name of defaults) {
      const src = mathData[name];
      if (!Array.isArray(src) || src.length === 0) continue;
      const out = new Float64Array(n);
      if (mathTc.length === src.length) {
        // nearest-neighbor interpolation
        let j = 0;
        for (let i = 0; i < n; i++) {
          const t = realTc[i] - startMs;
          while (j < mathTc.length - 1 && Math.abs(mathTc[j + 1] - t) <= Math.abs(mathTc[j] - t)) {
            j++;
          }
          out[i] = src[Math.min(j, src.length - 1)];
        }
      } else {
        // Fallback: index-scale
        for (let i = 0; i < n; i++) {
          const idx = Math.min(src.length - 1, Math.floor((i / Math.max(1, n - 1)) * (src.length - 1)));
          out[i] = src[idx];
        }
      }
      merged.channels[name] = out;
    }
    return merged;
  }

  // No channels at all
  return { timecodes: new Float64Array(), channels: {}, rowCount: 0 };
}

// ---- Distance data ----

export interface DistanceData {
  timecodes: number[];
  distance_m: number[];
}

export async function fetchDistance(
  sessionId: string,
  lap: number
): Promise<DistanceData> {
  const res = await fetch(
    `/api/sessions/${sessionId}/distance?lap=${lap}`
  );
  if (!res.ok) throw new Error(`Failed to fetch distance: ${res.status}`);
  return res.json();
}

// ---- Delta-T ----

export interface DeltaTData {
  distance_m: number[];
  delta_seconds: number[];
}

export async function fetchDeltaT(
  sessionId: string,
  refLap: number,
  compareLap: number
): Promise<DeltaTData> {
  const res = await fetch(
    `/api/sessions/${sessionId}/delta-t?ref_lap=${refLap}&compare_lap=${compareLap}`
  );
  if (!res.ok) throw new Error(`Failed to fetch delta-T: ${res.status}`);
  return res.json();
}

export interface PredictiveData {
  distance: number[];
  delta_ms: number[];
}

export async function fetchPredictive(
  sessionId: string,
  refLap: number,
  currentLap: number
): Promise<PredictiveData> {
  const res = await fetch(
    `/api/sessions/${sessionId}/predictive?ref_lap=${refLap}&current_lap=${currentLap}`
  );
  if (!res.ok) throw new Error(`Failed to fetch predictive: ${res.status}`);
  return res.json();
}

export async function fetchCrossSessionDeltaT(
  ref: { session_id: string; lap: number },
  compare: { session_id: string; lap: number }
): Promise<DeltaTData> {
  const res = await fetch(`/api/compare/delta-t`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, compare }),
  });
  if (!res.ok) throw new Error(`Failed to fetch cross-session delta-T: ${res.status}`);
  return res.json();
}

// ---- Channel stats ----

export interface ChannelStats {
  min: number;
  max: number;
  avg: number;
  stdev: number;
  p5: number;
  p50: number;
  p95: number;
  count: number;
}

export async function fetchStats(
  sessionId: string,
  channels: string[],
  lap: number
): Promise<Record<string, ChannelStats>> {
  const params = new URLSearchParams({
    channels: channels.join(","),
    lap: String(lap),
  });
  const res = await fetch(`/api/sessions/${sessionId}/stats?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

// ---- Track overlay ----

export interface TrackOverlayData {
  lat: number[];
  lon: number[];
  values: number[] | null;
  channel: string;
  point_count: number;
}

// ---- Sectors ----

export interface SectorDef {
  sector_num: number;
  start_distance_m: number;
  end_distance_m: number;
  label: string;
}

export interface SectorTime {
  lap_num: number;
  sector_num: number;
  duration_ms: number;
}

export interface SectorsResult {
  sectors: SectorDef[];
  sector_times: SectorTime[];
  theoretical_best_ms: number | null;
}

export interface AutoDetectResult extends SectorsResult {
  total_distance_m: number;
}

export async function autoDetectSectors(
  sessionId: string,
  numSectors: number = 3
): Promise<AutoDetectResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/sectors/auto-detect?num_sectors=${numSectors}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Failed to auto-detect sectors: ${res.status}`);
  return res.json();
}

export async function fetchSectors(
  sessionId: string
): Promise<SectorsResult> {
  const res = await fetch(`/api/sessions/${sessionId}/sectors`);
  if (!res.ok) throw new Error(`Failed to fetch sectors: ${res.status}`);
  return res.json();
}

// ---- Math channels ----

export interface MathChannel {
  name: string;
  formula: string;
  units: string;
  created_at?: string;
}

export async function createMathChannel(
  sessionId: string,
  name: string,
  formula: string,
  units: string = ""
): Promise<{ name: string; formula: string; units: string; sample_count: number }> {
  const res = await fetch(`/api/sessions/${sessionId}/math-channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, formula, units }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Failed to create math channel");
    throw new Error(text);
  }
  return res.json();
}

export async function fetchMathChannels(
  sessionId: string
): Promise<MathChannel[]> {
  const res = await fetch(`/api/sessions/${sessionId}/math-channels`);
  if (!res.ok) throw new Error(`Failed to fetch math channels: ${res.status}`);
  return res.json();
}

export async function deleteMathChannel(
  sessionId: string,
  name: string
): Promise<void> {
  const res = await fetch(
    `/api/sessions/${sessionId}/math-channels/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`Failed to delete math channel: ${res.status}`);
}

// ---- Layouts ----

export interface Layout {
  id: number;
  name: string;
  config_json: string;
  created_at: string;
}

export async function fetchLayouts(): Promise<Layout[]> {
  const res = await fetch("/api/layouts");
  if (!res.ok) throw new Error(`Failed to fetch layouts: ${res.status}`);
  return res.json();
}

export async function saveLayout(name: string, config: object): Promise<Layout> {
  const res = await fetch("/api/layouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, config_json: JSON.stringify(config) }),
  });
  if (!res.ok) throw new Error(`Failed to save layout: ${res.status}`);
  return res.json();
}

// ---- Profile export/import (Phase 20.3) ----

export interface ProfileExport {
  version: number;
  exported_at: string;
  layouts: { id: number; name: string; config_json: string }[];
  alarms: unknown[];
  math_channels: unknown[];
  channel_settings: unknown[];
}

export async function exportProfile(): Promise<ProfileExport> {
  const res = await fetch(`/api/profile/export`);
  if (!res.ok) throw new Error(`Failed to export profile: ${res.status}`);
  return res.json();
}

export async function importProfile(
  blob: Omit<ProfileExport, "exported_at">,
  merge = true
): Promise<{ imported: Record<string, number> }> {
  const res = await fetch(`/api/profile/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...blob, merge }),
  });
  if (!res.ok) throw new Error(`Failed to import profile: ${res.status}`);
  return res.json();
}

export async function deleteLayout(id: number): Promise<void> {
  const res = await fetch(`/api/layouts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete layout: ${res.status}`);
}

// ---- Session notes ----

export interface SessionNote {
  note_text: string;
  created_at: string | null;
  updated_at: string | null;
}

export async function fetchSessionNotes(sessionId: string): Promise<SessionNote> {
  const res = await fetch(`/api/sessions/${sessionId}/notes`);
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json();
}

export async function saveSessionNotes(
  sessionId: string,
  noteText: string
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/notes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_text: noteText }),
  });
  if (!res.ok) throw new Error(`Failed to save notes: ${res.status}`);
}

// ---- Export ----

export function getExportCsvUrl(
  sessionId: string,
  channels: string[],
  lap: number
): string {
  const params = new URLSearchParams({
    channels: channels.join(","),
    lap: String(lap),
  });
  return `/api/sessions/${sessionId}/export/csv?${params}`;
}

export async function assignSession(
  sessionId: string,
  assignment: { driver_id?: number | null; vehicle_id?: number | null; track_id?: number | null }
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/assign`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignment),
  });
  if (!res.ok) throw new Error(`Failed to assign session: ${res.status}`);
}

// ---- Tracks ----

export interface SfLine {
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
}

export interface Track {
  id: number;
  name: string;
  country: string;
  length_m: number;
  gps_outline: number[][];
  sector_defs: Record<string, unknown>[];
  short_name?: string;
  city?: string;
  type?: string;
  surface?: string;
  timezone?: string;
  sf_line?: SfLine | null;
  split_lines?: SfLine[];
  pit_lane?: number[][];
}

export async function fetchTracks(): Promise<Track[]> {
  const res = await fetch("/api/tracks");
  if (!res.ok) throw new Error(`Failed to fetch tracks: ${res.status}`);
  return res.json();
}

export async function createTrack(track: Omit<Track, "id">): Promise<{ id: number }> {
  const res = await fetch("/api/tracks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(track),
  });
  if (!res.ok) throw new Error(`Failed to create track: ${res.status}`);
  return res.json();
}

export async function matchTrack(
  gpsOutline: number[][],
  lengthM?: number
): Promise<{ match: { id: number; name: string; distance_m: number; score: number } | null; threshold_m: number; matched: boolean }> {
  const res = await fetch("/api/tracks/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gps_outline: gpsOutline, length_m: lengthM }),
  });
  if (!res.ok) throw new Error(`Failed to match track: ${res.status}`);
  return res.json();
}

export interface RecomputeLapsResult {
  laps: Lap[];
  crossings: number;
  best_lap_time_ms: number;
}

export async function recomputeLapsFromLine(
  sessionId: string,
  line: { lat1: number; lon1: number; lat2: number; lon2: number }
): Promise<RecomputeLapsResult> {
  const res = await fetch(`/api/sessions/${sessionId}/laps/recompute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to recompute laps: ${res.status}`);
  }
  return res.json();
}

export interface LapDiagnostic {
  num: number;
  start_time_ms_libxrk: number;
  first_sample_timecode_ms: number;
  diff_ms: number;
}

export async function fetchLapDiagnostics(sessionId: string): Promise<LapDiagnostic[]> {
  const res = await fetch(`/api/sessions/${sessionId}/laps/diagnostics`);
  if (!res.ok) throw new Error(`Failed to fetch lap diagnostics: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.laps ?? []);
}

export async function deleteTrack(id: number): Promise<void> {
  const res = await fetch(`/api/tracks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete track: ${res.status}`);
}

export async function fetchTrackById(id: number): Promise<Track> {
  const res = await fetch(`/api/tracks/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch track: ${res.status}`);
  return res.json();
}

export async function updateTrack(id: number, track: Omit<Track, "id">): Promise<void> {
  const res = await fetch(`/api/tracks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(track),
  });
  if (!res.ok) throw new Error(`Failed to update track: ${res.status}`);
}

export async function setTrackSfLine(id: number, line: SfLine): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/sf-line`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  if (!res.ok) throw new Error(`Failed to set S/F line: ${res.status}`);
}

export async function setTrackPitLane(
  id: number,
  polygon: { lat: number; lon: number }[]
): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/pit-lane`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ polygon }),
  });
  if (!res.ok) throw new Error(`Failed to set pit lane: ${res.status}`);
}

export async function setTrackSplits(id: number, splits: SfLine[]): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/splits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ splits }),
  });
  if (!res.ok) throw new Error(`Failed to set splits: ${res.status}`);
}

export async function clearTrackSfLine(id: number): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/sf-line`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear S/F line: ${res.status}`);
}

export async function clearTrackPitLane(id: number): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/pit-lane`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear pit lane: ${res.status}`);
}

export async function clearTrackSplits(id: number): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/splits`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear splits: ${res.status}`);
}

export interface MultiSessionReportRow {
  session_id: string;
  file_name: string;
  driver: string;
  venue: string;
  log_date: string;
  lap_count: number;
  best_lap_ms: number | null;
  avg_lap_ms: number | null;
  median_lap_ms?: number | null;
  stddev_lap_ms?: number | null;
  theoretical_best_ms?: number | null;
  counted_laps: number;
}

export async function fetchMultiSessionReport(sessionIds: string[]): Promise<{ sessions: MultiSessionReportRow[] }> {
  const qs = new URLSearchParams({ session_ids: sessionIds.join(",") });
  const res = await fetch(`/api/reports/multi-session?${qs}`);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export async function fetchSetting(key: string): Promise<string> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const j = await res.json();
  return j.value ?? "";
}

export async function clearAllSessions(): Promise<{ ok: boolean; purged: string[] }> {
  const res = await fetch(`/api/admin/sessions`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
}

const _mathDefaultsCache = new Map<string, Promise<Record<string, number[]>>>();

export async function fetchMathDefaults(
  sessionId: string, lap: number, channel?: string,
): Promise<Record<string, number[]>> {
  // Only cache full-response (no channel filter) keyed by sessionId:lap.
  if (!channel) {
    const key = `${sessionId}:${lap}`;
    const cached = _mathDefaultsCache.get(key);
    if (cached) return cached;
    const p = (async () => {
      const qs = new URLSearchParams({ lap: String(lap) });
      const res = await fetch(`/api/sessions/${sessionId}/math-defaults?${qs}`);
      if (!res.ok) throw new Error(`Failed to fetch math defaults: ${res.status}`);
      return res.json();
    })().catch((e) => {
      _mathDefaultsCache.delete(key);
      throw e;
    });
    _mathDefaultsCache.set(key, p);
    return p;
  }
  const qs = new URLSearchParams({ lap: String(lap) });
  qs.set("channel", channel);
  const res = await fetch(`/api/sessions/${sessionId}/math-defaults?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch math defaults: ${res.status}`);
  return res.json();
}

export interface LogSheet {
  weather: string;
  track_temp: number;
  air_temp: number;
  tire_pressures_json: string;
  setup_notes: string;
  fuel_level: number;
  driver_rating: number;
}

export async function fetchLogSheet(sessionId: string): Promise<LogSheet> {
  const res = await fetch(`/api/sessions/${sessionId}/log-sheet`);
  if (!res.ok) throw new Error(`Failed to fetch log sheet: ${res.status}`);
  return res.json();
}

export async function fetchSessionWeather(sessionId: string): Promise<{
  ok: boolean;
  weather: string;
  air_temp: number;
  track_temp: number;
  source: string;
}> {
  const res = await fetch(`/api/sessions/${sessionId}/fetch-weather`, {
    method: "POST",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Failed: ${res.status}`);
  }
  return res.json();
}

export async function saveLogSheet(sessionId: string, sheet: LogSheet): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/log-sheet`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sheet),
  });
  if (!res.ok) throw new Error(`Failed to save log sheet: ${res.status}`);
}

export async function recomputeFromTrack(sessionId: string, trackId: number): Promise<RecomputeLapsResult> {
  const res = await fetch(`/api/sessions/${sessionId}/recompute-from-track?track_id=${trackId}`, {
    method: "POST",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Failed to recompute: ${res.status}`);
  }
  return res.json();
}

export function getExportPdfUrl(sessionId: string, lap?: number): string {
  const qs = lap != null ? `?lap=${lap}` : "";
  return `/api/sessions/${sessionId}/export/pdf${qs}`;
}

export async function fetchReport(sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/sessions/${sessionId}/export/report`);
  if (!res.ok) throw new Error(`Failed to fetch report: ${res.status}`);
  return res.json();
}

// ---- Drivers & Vehicles ----

export interface Driver {
  id: number;
  name: string;
  weight_kg: number;
  created_at: string;
  session_count?: number;
  last_session_date?: string | null;
  best_lap_time_ms?: number | null;
}

export interface Vehicle {
  id: number;
  name: string;
  class: string;
  engine: string;
  created_at: string;
}

export async function fetchDrivers(): Promise<Driver[]> {
  const res = await fetch("/api/drivers");
  if (!res.ok) throw new Error(`Failed to fetch drivers: ${res.status}`);
  return res.json();
}

export async function createDriver(name: string, weightKg: number = 0): Promise<Driver> {
  const res = await fetch("/api/drivers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, weight_kg: weightKg }),
  });
  if (!res.ok) throw new Error(`Failed to create driver: ${res.status}`);
  return res.json();
}

export async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch("/api/vehicles");
  if (!res.ok) throw new Error(`Failed to fetch vehicles: ${res.status}`);
  return res.json();
}

export async function createVehicle(
  name: string,
  vehicleClass: string = "",
  engine: string = ""
): Promise<Vehicle> {
  const res = await fetch("/api/vehicles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, vehicle_class: vehicleClass, engine }),
  });
  if (!res.ok) throw new Error(`Failed to create vehicle: ${res.status}`);
  return res.json();
}

// ---- Collections (venue/date tree — legacy) ----

export async function fetchCollections(): Promise<Record<string, Record<string, Session[]>>> {
  const res = await fetch("/api/sessions/collections");
  if (!res.ok) throw new Error(`Failed to fetch collections: ${res.status}`);
  return res.json();
}

// ---- Smart Collections ----

export interface SmartCollectionQuery {
  driver_id?: number | null;
  vehicle_id?: number | null;
  track_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  min_laps?: number | null;
}

export interface SmartCollection {
  id: number;
  name: string;
  query: SmartCollectionQuery;
  created_at: string;
}

export async function fetchSmartCollections(): Promise<SmartCollection[]> {
  const res = await fetch("/api/collections");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export async function createSmartCollection(
  name: string, query: SmartCollectionQuery,
): Promise<{ id: number }> {
  const res = await fetch("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, query }),
  });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

export async function deleteSmartCollection(id: number): Promise<void> {
  const res = await fetch(`/api/collections/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
}

export async function fetchSmartCollectionSessions(id: number): Promise<Session[]> {
  const res = await fetch(`/api/collections/${id}/sessions`);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
}

// ---- Anomalies (Phase 1: Stint AI — Anomaly Watchdog) ----

export type AnomalySeverity = "critical" | "warning" | "info";

export interface Anomaly {
  id: number;
  type: string;
  severity: AnomalySeverity;
  lap_num: number | null;
  channel: string | null;
  message: string;
  metric_value: number | null;
  /** Lap-relative position of the offending sample, when known (T1.6). */
  distance_pct?: number | null;
  /** Lap-relative time of the offending sample, when known (T1.6). */
  time_in_lap_ms?: number | null;
  created_at?: string;
}

export interface AnomalyCounts {
  critical: number;
  warning: number;
  info: number;
}

export interface AnomalyResponse {
  counts: AnomalyCounts;
  items: Anomaly[];
}

export async function fetchAnomalies(sessionId: string): Promise<AnomalyResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/anomalies?_t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch anomalies: ${res.status}`);
  return res.json();
}

export async function fetchAnomalySummary(sessionId: string): Promise<AnomalyCounts> {
  const res = await fetch(`/api/sessions/${sessionId}/anomalies/summary?_t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch anomaly summary: ${res.status}`);
  return res.json();
}

export async function recomputeAnomalies(sessionId: string): Promise<AnomalyResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/anomalies/recompute`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to recompute anomalies: ${res.status}`);
  const data = await res.json();
  // /recompute returns { count, items }; normalize to AnomalyResponse shape
  const counts: AnomalyCounts = { critical: 0, warning: 0, info: 0 };
  for (const item of data.items as Anomaly[]) {
    counts[item.severity] = (counts[item.severity] ?? 0) + 1;
  }
  return { counts, items: data.items };
}

// ---- Auto-Debrief (Phase 2: Stint AI) ----

export interface DebriefLapConsistency {
  lap_count: number;
  best_ms: number | null;
  mean_ms: number | null;
  stddev_ms: number | null;
  coefficient_of_variation: number | null;
  best_streak: number;
  clean_lap_count: number;
}

export interface DebriefSectorConsistency {
  sector_num: number;
  best_ms: number;
  mean_ms: number | null;
  stddev_ms: number | null;
}

export interface DebriefCornerPerformance {
  sector_num: number;
  best_ms: number;
  mean_ms: number;
  stddev_ms: number;
  delta_to_best_pct: number;
  cov_pct: number;
  score: number;
}

export interface DebriefSessionTrend {
  lap_trend_slope_ms_per_lap: number;
  lap_trend_r: number;
  insight: string;
  weather_context: {
    weather: string;
    track_temp: number | null;
    air_temp: number | null;
  };
}
/** @deprecated use {@link DebriefSessionTrend}. */
export type DebriefWeatherCorrelation = DebriefSessionTrend;

export interface DebriefNarrative {
  status: "pending" | "ready" | "failed";
  summary: string;
  action_items: string[];
}

export interface DebriefDrivingFingerprint {
  reference_lap: number;
  throttle_smoothness?: number;
  braking_aggressiveness?: number;
  max_brake?: number;
  steering_smoothness?: number;
}

export interface DebriefMeta {
  driver: string;
  vehicle: string;
  venue: string;
  log_date: string;
  lap_count: number;
  best_lap_ms: number | null;
}

export interface Debrief {
  session_id: string;
  meta: DebriefMeta;
  lap_consistency: DebriefLapConsistency;
  sector_consistency: DebriefSectorConsistency[];
  corner_performance: DebriefCornerPerformance[];
  /** Renamed in T1.8 — falls back to weather_correlation for older payloads. */
  session_trend?: DebriefSessionTrend | null;
  weather_correlation?: DebriefSessionTrend | null;
  driving_fingerprint: DebriefDrivingFingerprint | null;
  narrative?: DebriefNarrative;
  _generated_at?: string;
}

/** Per-lap fingerprint history (T2.4) */
export interface LapFingerprint {
  lap_num: number;
  throttle_smoothness: number | null;
  braking_aggressiveness: number | null;
  max_brake: number | null;
  steering_smoothness: number | null;
}

export async function fetchPerLapFingerprints(sessionId: string): Promise<LapFingerprint[]> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/fingerprints?_t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { laps?: LapFingerprint[] };
    return data.laps ?? [];
  } catch {
    return [];
  }
}

export interface FingerprintBenchmark {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  n: number;
}
export type DriverFingerprintStats = Record<string, FingerprintBenchmark>;

export async function fetchDriverFingerprintStats(driver: string): Promise<DriverFingerprintStats> {
  try {
    const res = await fetch(`/api/drivers/${encodeURIComponent(driver)}/fingerprint-stats`);
    if (!res.ok) return {};
    const data = (await res.json()) as { metrics?: DriverFingerprintStats };
    return data.metrics ?? {};
  } catch {
    return {};
  }
}

export interface ProactiveNudge {
  headline: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  prompt: string;
}

export async function fetchSessionNudge(sessionId: string): Promise<ProactiveNudge | null> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/nudge`);
    if (!res.ok) return null;
    const data = (await res.json()) as { nudge?: ProactiveNudge | null };
    return data.nudge ?? null;
  } catch {
    return null;
  }
}

export async function dismissSessionNudge(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/sessions/${sessionId}/nudge/dismiss`, { method: "POST" });
  } catch {
    /* ignore */
  }
}

export async function fetchSessionTags(sessionId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: string[] };
    return data.tags ?? [];
  } catch {
    return [];
  }
}

export interface ChatUsageStats {
  total_tokens_in: number;
  total_tokens_out: number;
  month_tokens_in: number;
  month_tokens_out: number;
  message_count: number;
  per_model: { model: string; n: number }[];
}

export async function backfillAllSessions(): Promise<{
  queued: number;
  session_count: number;
  kind: string;
  note: string;
}> {
  const res = await fetch("/api/admin/backfill", { method: "POST" });
  if (!res.ok) throw new Error(`Backfill failed: ${res.status}`);
  return res.json();
}

export async function fetchChatUsage(): Promise<ChatUsageStats | null> {
  try {
    const res = await fetch("/api/chat/usage");
    if (!res.ok) return null;
    return (await res.json()) as ChatUsageStats;
  } catch {
    return null;
  }
}

// ---- T4.1 — Coaching plan + memory ---------------------------------------

export type FocusItemStatus = "open" | "improved" | "same" | "worse" | "abandoned";

export interface FocusItemEvaluation {
  before: number | null;
  after: number | null;
  delta: number | null;
  target_value: number | null;
}

export interface FocusItem {
  id: number;
  item_text: string;
  target_metric: string;
  target_value: number | null;
  status: FocusItemStatus;
  evaluation?: FocusItemEvaluation | null;
}

export interface CoachingPlan {
  plan_id: number;
  session_id: string;
  created_at: string;
  items: FocusItem[];
  prior_session_id?: string;
}

export interface CoachingPlanResponse {
  plan: CoachingPlan | null;
  prior: CoachingPlan | null;
}

export async function fetchCoachingPlan(sessionId: string): Promise<CoachingPlanResponse> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/coaching-plan`);
    if (!res.ok) return { plan: null, prior: null };
    return (await res.json()) as CoachingPlanResponse;
  } catch {
    return { plan: null, prior: null };
  }
}

// ---- Driver analytics ----------------------------------------------------

export interface DriverSummaryStats {
  session_count: number;
  venue_count: number;
  total_laps: number;
  overall_pb_ms: number | null;
  overall_pb_session_id: string | null;
  overall_pb_venue: string | null;
  last_session_date: string | null;
}

export interface DriverVenuePB {
  venue: string;
  best_lap_ms: number;
  session_id: string;
  log_date: string | null;
  session_count: number;
}

export interface DriverFingerprintPoint {
  session_id: string;
  log_date: string | null;
  venue: string | null;
  throttle_smoothness: number | null;
  braking_aggressiveness: number | null;
  max_brake: number | null;
  steering_smoothness: number | null;
}

export interface DriverSessionRow {
  id: string;
  venue: string | null;
  vehicle: string | null;
  log_date: string | null;
  log_time: string | null;
  lap_count: number;
  best_lap_time_ms: number | null;
  total_duration_ms: number | null;
  tags: string[];
}

export interface DriverSummary {
  driver: string;
  stats: DriverSummaryStats;
  tag_counts: Record<string, number>;
  pb_per_venue: DriverVenuePB[];
  fingerprint_series: DriverFingerprintPoint[];
  sessions: DriverSessionRow[];
}

export async function fetchDriverSummary(name: string): Promise<DriverSummary | null> {
  try {
    const res = await fetch(`/api/drivers/${encodeURIComponent(name)}/summary`);
    if (!res.ok) return null;
    return (await res.json()) as DriverSummary;
  } catch {
    return null;
  }
}

export async function regenerateCoachingPlan(sessionId: string): Promise<CoachingPlanResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/coaching-plan/regenerate`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to regenerate coaching plan: ${res.status}`);
  return (await res.json()) as CoachingPlanResponse;
}

export async function fetchDebrief(sessionId: string): Promise<Debrief> {
  const res = await fetch(`/api/sessions/${sessionId}/debrief?_t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch debrief: ${res.status}`);
  return res.json();
}

export async function recomputeDebrief(sessionId: string): Promise<Debrief> {
  const res = await fetch(`/api/sessions/${sessionId}/debrief/recompute`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to recompute debrief: ${res.status}`);
  return res.json();
}

// ---- Chat (Phase 3: Ask Your Data) ----

export interface ChatConversation {
  id: number;
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  /** Joined from sessions for use by the /chat sidebar. */
  session_venue?: string | null;
  session_driver?: string | null;
  session_log_date?: string | null;
}

export type ChatRole = "user" | "assistant" | "tool" | "system";

/**
 * AI SDK v5 UIMessage shape. We persist messages on the backend in this
 * exact shape so the frontend can hydrate `useChat` without translation.
 */
export interface ChatUIMessagePart {
  type: string; // "text" | "reasoning" | "tool-<name>" | etc.
  text?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  summary?: string;
}

export interface ChatUIMessage {
  id: string;
  role: ChatRole;
  parts: ChatUIMessagePart[];
  createdAt?: string;
  metadata?: {
    tokensIn?: number | null;
    tokensOut?: number | null;
    model?: string | null;
  };
}

export async function createChatConversation(
  sessionId: string,
  title = "",
): Promise<ChatConversation> {
  const res = await fetch("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, title }),
  });
  if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`);
  return res.json();
}

export async function listChatConversations(
  sessionId: string,
): Promise<ChatConversation[]> {
  const res = await fetch(
    `/api/chat/conversations?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
  return res.json();
}

/** List ALL conversations across the archive (for the dedicated /chat page). */
export async function listAllChatConversations(): Promise<ChatConversation[]> {
  const res = await fetch("/api/chat/conversations");
  if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
  return res.json();
}

export async function fetchChatConversation(
  conversationId: number,
): Promise<{ conversation: ChatConversation; messages: ChatUIMessage[] }> {
  const res = await fetch(`/api/chat/conversations/${conversationId}`);
  if (!res.ok) throw new Error(`Failed to fetch conversation: ${res.status}`);
  return res.json();
}

export async function deleteChatConversation(conversationId: number): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${conversationId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete conversation: ${res.status}`);
}

/** Dynamic suggestion chips derived from session debrief + anomalies (T1.2). */
export async function fetchChatSuggestions(sessionId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/chat-suggestions`);
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: string[] };
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

/**
 * Stream a chat response — handled by `useChat` from @ai-sdk/react with a
 * `DefaultChatTransport` pointed at /api/chat/message. Backend emits the
 * v5 UI message stream protocol (`x-vercel-ai-ui-message-stream: v1`).
 *
 * The legacy custom SSE helper that lived here was removed during the
 * AI SDK rebaseline (Phase 0).
 */

// ---- Track overlay ----

export async function fetchTrackOverlay(
  sessionId: string,
  channel: string,
  lap?: number
): Promise<TrackOverlayData> {
  const params = new URLSearchParams({ channel });
  if (lap !== undefined) params.set("lap", String(lap));
  const res = await fetch(
    `/api/sessions/${sessionId}/track-overlay?${params}`
  );
  if (!res.ok) throw new Error(`Failed to fetch track overlay: ${res.status}`);
  return res.json();
}

// ---- Channel alarms (Phase 19) ----

export type AlarmScope = "global" | "driver" | "session";
export type AlarmKind = "min" | "max" | "between" | "outside";
export type AlarmSeverity = "info" | "warning" | "critical";

export interface ChannelAlarm {
  id: number;
  scope: AlarmScope;
  session_id: string | null;
  driver: string;
  channel: string;
  kind: AlarmKind;
  threshold_a: number | null;
  threshold_b: number | null;
  severity: AlarmSeverity;
  message: string;
  created_at: string;
}

export interface AlarmInput {
  scope?: AlarmScope;
  session_id?: string | null;
  driver?: string | null;
  channel: string;
  kind: AlarmKind;
  threshold_a?: number | null;
  threshold_b?: number | null;
  severity?: AlarmSeverity;
  message?: string | null;
}

export async function fetchAlarms(params?: {
  session_id?: string;
  driver?: string;
}): Promise<ChannelAlarm[]> {
  const q = new URLSearchParams();
  if (params?.session_id) q.set("session_id", params.session_id);
  if (params?.driver) q.set("driver", params.driver);
  const res = await fetch(`/api/alarms?${q.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch alarms: ${res.status}`);
  return res.json();
}

export async function createAlarm(a: AlarmInput): Promise<{ id: number }> {
  const res = await fetch(`/api/alarms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(a),
  });
  if (!res.ok) throw new Error(`Failed to create alarm: ${res.status}`);
  return res.json();
}

export async function deleteAlarm(id: number): Promise<void> {
  const res = await fetch(`/api/alarms/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete alarm: ${res.status}`);
}

export interface AlarmPreview {
  channel: string;
  triggering_laps: { lap_num: number; samples: number }[];
  sample_count: number;
}

export async function previewAlarm(
  sessionId: string,
  alarm: AlarmInput
): Promise<AlarmPreview> {
  const res = await fetch(`/api/sessions/${sessionId}/alarms/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alarm }),
  });
  if (!res.ok) throw new Error(`Failed to preview alarm: ${res.status}`);
  return res.json();
}

// ---- Reference laps (Phase 15) ----

export type ReferenceLapKind = "user" | "pb" | "track-record";

export interface ReferenceLap {
  id: number;
  session_id: string | null;
  lap_num: number;
  driver: string;
  venue: string;
  name: string;
  kind: ReferenceLapKind;
  is_default: number;
  created_at: string;
  /** Populated by /sessions/{id}/default-reference when known */
  duration_ms?: number | null;
}

export async function fetchReferenceLaps(
  driver?: string,
  venue?: string
): Promise<ReferenceLap[]> {
  const q = new URLSearchParams();
  if (driver) q.set("driver", driver);
  if (venue) q.set("venue", venue);
  const res = await fetch(`/api/reference-laps?${q.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch reference laps: ${res.status}`);
  return res.json();
}

export async function createReferenceLap(
  sessionId: string,
  lapNum: number,
  opts?: { name?: string; setDefault?: boolean }
): Promise<{ id: number }> {
  const res = await fetch(`/api/reference-laps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      lap_num: lapNum,
      name: opts?.name,
      set_default: opts?.setDefault ?? true,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create reference lap: ${res.status}`);
  return res.json();
}

export async function setDefaultReferenceLap(id: number): Promise<void> {
  const res = await fetch(`/api/reference-laps/${id}/set-default`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to set default: ${res.status}`);
}

export async function deleteReferenceLap(id: number): Promise<void> {
  const res = await fetch(`/api/reference-laps/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete reference lap: ${res.status}`);
}

export async function fetchDefaultReference(
  sessionId: string
): Promise<{ reference: ReferenceLap | null }> {
  const res = await fetch(`/api/sessions/${sessionId}/default-reference`);
  if (!res.ok) throw new Error(`Failed to fetch default reference: ${res.status}`);
  return res.json();
}

// ---- Session reports (Phase 14) ----

export interface SplitReportLap {
  num: number;
  duration_ms: number;
  is_pit_lap: boolean;
  splits: (number | null)[];
  best_of_session_mask: boolean[];
}

export interface SplitReportData {
  sectors: { sector_num: number; label: string }[];
  laps: SplitReportLap[];
  best_rolling_lap: { num: number; duration_ms: number } | null;
  theoretical_best_ms: number | null;
  rolling_vs_theoretical_ms: number | null;
}

export async function fetchSplitReport(sessionId: string): Promise<SplitReportData> {
  const res = await fetch(`/api/sessions/${sessionId}/split-report`);
  if (!res.ok) throw new Error(`Failed to fetch split report: ${res.status}`);
  return res.json();
}

export type ChannelStatKey =
  | "min"
  | "max"
  | "avg"
  | "p50"
  | "p90"
  | "p99"
  | "std"
  | "count";

export interface ChannelsReportLap {
  num: number;
  duration_ms: number;
  is_pit_lap: boolean;
  cells: Record<string, Partial<Record<ChannelStatKey, number | null>>>;
}

export interface ChannelsReportData {
  channels: string[];
  stats: ChannelStatKey[];
  laps: ChannelsReportLap[];
  session_wide: Record<string, Partial<Record<ChannelStatKey, number | null>>>;
}

export async function fetchChannelsReport(
  sessionId: string,
  channels: string[],
  stats: ChannelStatKey[] = ["min", "max", "avg", "p90"],
  includePitLaps = false
): Promise<ChannelsReportData> {
  const params = new URLSearchParams({
    channels: channels.join(","),
    stats: stats.join(","),
  });
  if (includePitLaps) params.set("include_pit_laps", "1");
  const res = await fetch(`/api/sessions/${sessionId}/channels-report?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch channels report: ${res.status}`);
  return res.json();
}

// ---- Time-compare overlay (Phase 13.2) ----

export interface LapDeltaPointsData {
  lat: number[];
  lon: number[];
  delta_s: number[];
  ref: { session_id: string; lap: number };
}

/**
 * Per-GPS-point delta seconds vs a reference lap. Used by the track map to
 * colour the driven line by where time is won/lost vs the reference.
 */
export async function fetchLapDeltaPoints(
  sessionId: string,
  lap: number,
  ref: { session_id: string; lap: number }
): Promise<LapDeltaPointsData> {
  const res = await fetch(
    `/api/sessions/${sessionId}/laps/${lap}/delta-points`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch delta points: ${res.status}`);
  return res.json();
}
