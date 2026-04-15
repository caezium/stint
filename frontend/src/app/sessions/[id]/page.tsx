"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchSession,
  fetchTrack,
  fetchDrivers,
  fetchVehicles,
  fetchTracks,
  assignSession,
  fetchLapDiagnostics,
  recomputeFromTrack,
  type LapDiagnostic,
  type SessionDetail,
  type TrackData,
  type Driver,
  type Vehicle,
  type Track,
} from "@/lib/api";
import { LogSheetPanel } from "@/components/log-sheet-panel";
import { formatLapTime, CHANNEL_CATEGORIES } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrackMap } from "@/components/track-map";
import { StartFinishEditor } from "@/components/start-finish-editor";

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [diagnostics, setDiagnostics] = useState<LapDiagnostic[] | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [showSF, setShowSF] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchSession(id).then(setSession),
      fetchTrack(id).then(setTrack).catch(() => null),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchDrivers().then(setDrivers).catch(() => setDrivers([]));
    fetchVehicles().then(setVehicles).catch(() => setVehicles([]));
    fetchTracks().then(setTracks).catch(() => setTracks([]));
  }, [id]);

  const assignedTrack = tracks.find((t) => t.id === session?.track_id);

  async function handleAssign(field: "driver_id" | "vehicle_id", value: number | null) {
    if (!session) return;
    await assignSession(session.id, { [field]: value });
    setSession({ ...session, [field]: value });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <svg
          className="animate-spin h-5 w-5 mr-3"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading session...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="text-center py-20">
        <p className="text-destructive mb-2">Failed to load session</p>
        <p className="text-muted-foreground text-sm">{error}</p>
        <Link href="/sessions" className="mt-4 inline-block">
          <Button variant="secondary">Back to Sessions</Button>
        </Link>
      </div>
    );
  }

  // Compute best lap
  const validLaps = session.laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  const bestTime = validLaps.length
    ? Math.min(...validLaps.map((l) => l.duration_ms))
    : null;

  // Group channels by category
  const groupedChannels = groupChannelsByCategory(session.channels);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/sessions"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 inline-block"
      >
        &larr; Back to Sessions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {session.venue || "Session"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {session.driver && `${session.driver} \u2022 `}
            {session.log_date}
            {session.log_time && ` \u2022 ${session.log_time}`}
          </p>
        </div>
        <Link href={`/sessions/${id}/analysis`}>
          <Button>Open Analysis</Button>
        </Link>
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Driver</p>
            <select
              value={session.driver_id ?? ""}
              onChange={(e) =>
                handleAssign("driver_id", e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-full bg-muted rounded px-2 py-1 text-sm"
            >
              <option value="">{session.driver || "—"}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Vehicle</p>
            <select
              value={session.vehicle_id ?? ""}
              onChange={(e) =>
                handleAssign("vehicle_id", e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-full bg-muted rounded px-2 py-1 text-sm"
            >
              <option value="">{session.vehicle || "—"}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </CardContent>
        </Card>
        <MetaCard label="Logger" value={session.logger_model || "—"} />
        <MetaCard
          label="Duration"
          value={
            session.total_duration_ms
              ? formatLapTime(session.total_duration_ms)
              : "—"
          }
        />
      </div>

      {/* Track card */}
      {assignedTrack && (
        <Card className="mb-4">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Track</p>
              <p className="font-medium">{assignedTrack.name}</p>
              {assignedTrack.sf_line && (
                <p className="text-xs text-green-400">S/F line configured</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link href={`/tracks/${assignedTrack.id}/edit`}>
                <Button size="sm" variant="secondary">Edit track</Button>
              </Link>
              {assignedTrack.sf_line && (
                <Button
                  size="sm"
                  onClick={async () => {
                    setRecomputeMsg(null);
                    try {
                      const r = await recomputeFromTrack(id, assignedTrack.id);
                      setRecomputeMsg(`Recomputed ${r.laps.length} laps`);
                      const s = await fetchSession(id);
                      setSession(s);
                    } catch (e) {
                      setRecomputeMsg(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Recompute from track
                </Button>
              )}
            </div>
          </CardContent>
          {recomputeMsg && (
            <div className="px-4 pb-3 text-xs text-muted-foreground">{recomputeMsg}</div>
          )}
        </Card>
      )}

      <LogSheetPanel sessionId={id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Lap times table */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">
                  Lap Times
                  <Badge variant="secondary" className="ml-2">
                    {session.lap_count} laps
                  </Badge>
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Lap #</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Delta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {session.laps.map((lap) => {
                    const isOutLap = lap.num === 0;
                    const isBest =
                      bestTime !== null &&
                      lap.num > 0 &&
                      lap.duration_ms === bestTime;
                    const delta =
                      bestTime !== null && lap.num > 0 && lap.duration_ms > 0
                        ? lap.duration_ms - bestTime
                        : null;

                    return (
                      <TableRow
                        key={lap.num}
                        className={
                          isOutLap
                            ? "opacity-50"
                            : isBest
                              ? "bg-green-500/10"
                              : ""
                        }
                      >
                        <TableCell className="font-mono text-sm">
                          {isOutLap ? "Out" : lap.num}
                        </TableCell>
                        <TableCell
                          className={`font-mono text-sm ${
                            isBest ? "text-green-400 font-semibold" : ""
                          }`}
                        >
                          {lap.duration_ms > 0
                            ? formatLapTime(lap.duration_ms)
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {delta !== null && delta > 0
                            ? `+${(delta / 1000).toFixed(3)}`
                            : delta === 0
                              ? "BEST"
                              : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Lap-start diagnostics */}
          <div className="mt-4">
            <button
              type="button"
              onClick={async () => {
                setShowDiag((v) => !v);
                if (!diagnostics) {
                  try {
                    setDiagnostics(await fetchLapDiagnostics(id));
                  } catch {
                    setDiagnostics([]);
                  }
                }
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showDiag ? "Hide" : "Show"} lap-start diagnostics
            </button>
            {showDiag && diagnostics && (
              <Card className="mt-2">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Lap</TableHead>
                        <TableHead>libxrk start (ms)</TableHead>
                        <TableHead>first sample (ms)</TableHead>
                        <TableHead>diff (ms)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diagnostics.map((d) => (
                        <TableRow
                          key={d.num}
                          className={Math.abs(d.diff_ms) > 50 ? "text-amber-400" : ""}
                        >
                          <TableCell className="font-mono text-sm">{d.num}</TableCell>
                          <TableCell className="font-mono text-sm">{d.start_time_ms_libxrk}</TableCell>
                          <TableCell className="font-mono text-sm">{d.first_sample_timecode_ms}</TableCell>
                          <TableCell className="font-mono text-sm">{d.diff_ms}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Sidebar: Track map + Channels */}
        <div className="space-y-6">
          {/* Track map */}
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3">Track Map</h2>
              <TrackMap
                lat={track?.lat ?? []}
                lon={track?.lon ?? []}
                speed={track?.speed}
                width={340}
                height={280}
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowSF((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showSF ? "Hide" : "Set"} start/finish line
                </button>
                {showSF && (
                  <div className="mt-2">
                    <StartFinishEditor
                      sessionId={id}
                      track={track}
                      onRecomputed={() => fetchSession(id).then(setSession)}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Channels */}
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3">
                Channels
                <Badge variant="secondary" className="ml-2">
                  {session.channels.length}
                </Badge>
              </h2>
              <div className="space-y-4">
                {Object.entries(groupedChannels).map(([category, channels]) => (
                  <div key={category}>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      {category}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {channels.map((ch) => (
                        <Badge
                          key={ch.name}
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {ch.name}
                          {ch.units && (
                            <span className="text-muted-foreground ml-1">
                              ({ch.units})
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="font-medium text-sm truncate">{value}</p>
      </CardContent>
    </Card>
  );
}

function groupChannelsByCategory(
  channels: SessionDetail["channels"]
): Record<string, SessionDetail["channels"]> {
  const result: Record<string, SessionDetail["channels"]> = {};

  for (const ch of channels) {
    let matched = false;
    for (const [category, patterns] of Object.entries(CHANNEL_CATEGORIES)) {
      if (category === "Other") continue;
      if (patterns.some((p) => ch.name.toLowerCase().includes(p.toLowerCase()))) {
        if (!result[category]) result[category] = [];
        result[category].push(ch);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!result["Other"]) result["Other"] = [];
      result["Other"].push(ch);
    }
  }

  return result;
}
