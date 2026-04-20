"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchSession,
  fetchTrack,
  fetchTrackById,
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
import { AnomalyPanel } from "@/components/anomaly-panel";
import { AnnotationsPanel } from "@/components/annotations-panel";
import { ProposalsPanel } from "@/components/proposals-panel";
import {
  DebriefHeadline,
  DrivingFingerprintCard,
  SessionTrendCard,
  useDebrief,
} from "@/components/debrief-panel";
import { CoachingPlanCard } from "@/components/coaching-plan-card";
import { ConsistencyCard } from "@/components/consistency-card";
import { CornerHeatmap } from "@/components/corner-heatmap";
import { ChatPanel } from "@/components/chat-panel";
import { NudgeBanner } from "@/components/nudge-banner";
import { SessionHeaderStrip } from "@/components/session-detail/session-header-strip";
import { SessionStickyBar } from "@/components/session-detail/session-sticky-bar";
import { LapDeltaBars } from "@/components/session-detail/lap-delta-bars";
import { ActionRail } from "@/components/session-detail/action-rail";
import { useChatStore } from "@/stores/chat-store";
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

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [diagnostics, setDiagnostics] = useState<LapDiagnostic[] | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [boundTrack, setBoundTrack] = useState<Track | null>(null);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const heroRef = useRef<HTMLDivElement>(null);
  const setChatOpen = useChatStore((s) => s.setOpen);

  const {
    debrief,
    history,
    bench,
    loading: debriefLoading,
    error: debriefError,
    recomputing: debriefRecomputing,
    sessionTrend,
    recompute: recomputeDebriefHook,
  } = useDebrief(id);

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

  useEffect(() => {
    const tid = session?.track_id;
    if (tid == null) {
      setBoundTrack(null);
      return;
    }
    let cancelled = false;
    fetchTrackById(tid)
      .then((t) => { if (!cancelled) setBoundTrack(t); })
      .catch(() => { if (!cancelled) setBoundTrack(null); });
    return () => { cancelled = true; };
  }, [session?.track_id]);

  const assignedTrack = boundTrack ?? tracks.find((t) => t.id === session?.track_id) ?? null;

  async function handleAssign(field: "driver_id" | "vehicle_id", value: number | null) {
    if (!session) return;
    await assignSession(session.id, { [field]: value });
    setSession({ ...session, [field]: value });
  }

  async function handleRecomputeFromTrack() {
    if (!assignedTrack || !session) return;
    setRecomputeMsg(null);
    try {
      const r = await recomputeFromTrack(id, assignedTrack.id);
      setRecomputeMsg(`Recomputed ${r.laps.length} laps`);
      const s = await fetchSession(id);
      setSession(s);
    } catch (e) {
      setRecomputeMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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

  const validLaps = session.laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  const bestTime = validLaps.length
    ? Math.min(...validLaps.map((l) => l.duration_ms))
    : null;

  const cons = debrief?.lap_consistency;
  const covPct =
    cons?.coefficient_of_variation != null
      ? cons.coefficient_of_variation * 100
      : null;

  return (
    <>
      <SessionStickyBar
        session={session}
        heroRef={heroRef}
        onOpenChat={() => setChatOpen(true)}
      />
      <ChatPanel sessionId={id} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link
          href="/sessions"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-block mb-3"
        >
          &larr; Back to Sessions
        </Link>

        <SessionHeaderStrip
          ref={heroRef}
          session={session}
          assignedTrack={assignedTrack}
          track={track}
          drivers={drivers}
          vehicles={vehicles}
          onAssignDriver={(id) => handleAssign("driver_id", id)}
          onAssignVehicle={(id) => handleAssign("vehicle_id", id)}
          validLapCount={validLaps.length}
          bestMs={bestTime}
          durationMs={session.total_duration_ms ?? null}
          cleanLapCount={cons?.clean_lap_count ?? null}
          covPct={covPct}
        />

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6 items-start">
          {/* === Main scroll column === */}
          <div className="space-y-4 min-w-0">
            <NudgeBanner sessionId={id} />

            {/* Coach summary / Coaching plan */}
            {debriefLoading && (
              <Card><CardContent className="p-5 text-xs text-muted-foreground">Loading debrief…</CardContent></Card>
            )}
            {debriefError && (
              <Card><CardContent className="p-5 text-xs text-destructive">{debriefError}</CardContent></Card>
            )}
            {!debriefLoading && !debriefError && debrief && (
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <div className="xl:col-span-3">
                  <DebriefHeadline narrative={debrief.narrative} sessionId={id} />
                </div>
                <div className="xl:col-span-2">
                  <CoachingPlanCard sessionId={id} />
                </div>
              </div>
            )}

            {/* Lap pace viz + table */}
            <LapDeltaBars laps={session.laps} />

            {/* Session insights — consistency / corners / fingerprint */}
            {!debriefLoading && debrief && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <ConsistencyCard consistency={debrief.lap_consistency} />
                <CornerHeatmap corners={debrief.corner_performance} />
                {debrief.driving_fingerprint && (
                  <DrivingFingerprintCard
                    fp={debrief.driving_fingerprint}
                    history={history}
                    bench={bench}
                  />
                )}
              </div>
            )}

            {sessionTrend && <SessionTrendCard insight={sessionTrend} />}

            <AnomalyPanel sessionId={id} defaultCollapsed />

            <ProposalsPanel sessionId={id} />

            <AnnotationsPanel sessionId={id} laps={session.laps} />

            {/* Lap times table */}
            <Card>
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold text-sm">
                    Lap times
                    <Badge variant="secondary" className="ml-2">
                      {session.lap_count} laps
                    </Badge>
                  </h2>
                </div>
                {(() => {
                  const maxSplits = Math.max(
                    0,
                    ...session.laps.map((l) => (l.split_times ?? []).length),
                  );
                  return (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">#</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Delta</TableHead>
                          {Array.from({ length: maxSplits }).map((_, i) => (
                            <TableHead key={i} className="text-xs">S{i + 1}</TableHead>
                          ))}
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
                          const splits = lap.split_times ?? [];
                          return (
                            <TableRow
                              key={lap.num}
                              className={
                                isOutLap ? "opacity-50" : isBest ? "bg-green-500/10" : ""
                              }
                            >
                              <TableCell className="font-mono text-sm">
                                {isOutLap ? "Out" : lap.num}
                              </TableCell>
                              <TableCell
                                className={`font-mono text-sm ${isBest ? "text-green-400 font-semibold" : ""}`}
                              >
                                {lap.duration_ms > 0 ? formatLapTime(lap.duration_ms) : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">
                                {delta !== null && delta > 0
                                  ? `+${(delta / 1000).toFixed(3)}`
                                  : delta === 0
                                    ? "BEST"
                                    : "—"}
                              </TableCell>
                              {Array.from({ length: maxSplits }).map((_, i) => (
                                <TableCell key={i} className="font-mono text-xs text-muted-foreground">
                                  {splits[i] != null ? (splits[i]! / 1000).toFixed(2) : "—"}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  );
                })()}
              </CardContent>
            </Card>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Lap-start diagnostics
              </summary>
              <div className="mt-2">
                {!diagnostics && (
                  <button
                    onClick={async () => {
                      setShowDiag(true);
                      try {
                        setDiagnostics(await fetchLapDiagnostics(id));
                      } catch {
                        setDiagnostics([]);
                      }
                    }}
                    className="text-xs text-primary underline"
                  >
                    Load diagnostics
                  </button>
                )}
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
            </details>

            {/* Channels drawer */}
            <Card>
              <CardContent className="p-4">
                <details>
                  <summary className="cursor-pointer font-medium text-sm flex items-center">
                    Channels
                    <Badge variant="secondary" className="ml-2">
                      {session.channels.length}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      Expand
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    {Object.entries(groupChannelsByCategory(session.channels)).map(([category, channels]) => (
                      <div key={category}>
                        <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                          {category}
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {channels.map((ch) => (
                            <Badge
                              key={ch.name}
                              variant="outline"
                              className="text-[10px] font-normal"
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
                </details>
              </CardContent>
            </Card>

            <LogSheetPanel sessionId={id} />
          </div>

          {/* === Right action rail === */}
          <aside className="hidden lg:block sticky top-4 self-start">
            <ActionRail
              sessionId={id}
              hasTrack={!!assignedTrack}
              hasSfLine={!!assignedTrack?.sf_line}
              trackId={assignedTrack?.id ?? null}
              onOpenChat={() => setChatOpen(true)}
              onRecomputeFromTrack={
                assignedTrack?.sf_line ? handleRecomputeFromTrack : undefined
              }
              onRegenerateDebrief={recomputeDebriefHook}
              recomputeMsg={recomputeMsg}
              debriefRecomputing={debriefRecomputing}
            />
          </aside>
        </div>
      </div>
    </>
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
