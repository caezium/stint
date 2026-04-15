import { decodeArrowIPC, type ResampledData } from "./arrow-decode";

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
}

export interface Lap {
  num: number;
  start_time_ms: number;
  end_time_ms: number;
  duration_ms: number;
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

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json();
}

export async function fetchSession(id: number | string): Promise<SessionDetail> {
  const res = await fetch(`/api/sessions/${id}`);
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
  const params = new URLSearchParams({
    channels: channels.join(","),
    lap: String(lap),
  });
  if (refChannel) params.set("ref_channel", refChannel);

  const res = await fetch(`/api/sessions/${sessionId}/resampled?${params}`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch resampled data: ${res.status} ${await res.text().catch(() => "")}`
    );
  }

  const buffer = await res.arrayBuffer();
  return decodeArrowIPC(buffer);
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

export async function setTrackSplits(id: number, splits: SfLine[]): Promise<void> {
  const res = await fetch(`/api/tracks/${id}/splits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ splits }),
  });
  if (!res.ok) throw new Error(`Failed to set splits: ${res.status}`);
}

export async function fetchMathDefaults(
  sessionId: string, lap: number, channel?: string,
): Promise<Record<string, number[]>> {
  const qs = new URLSearchParams({ lap: String(lap) });
  if (channel) qs.set("channel", channel);
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
