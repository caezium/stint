"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchSession,
  fetchTrack,
  fetchCrossSessionDeltaT,
  type SessionDetail,
  type DeltaTData,
  type TrackData,
} from "@/lib/api";
import { TrackMap } from "@/components/track-map";

export default function ComparePage() {
  const params = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");

  const [sessionA, setSessionA] = useState<SessionDetail | null>(null);
  const [sessionB, setSessionB] = useState<SessionDetail | null>(null);
  const [lapA, setLapA] = useState<number | null>(null);
  const [lapB, setLapB] = useState<number | null>(null);
  const [delta, setDelta] = useState<DeltaTData | null>(null);
  const [trackA, setTrackA] = useState<TrackData | null>(null);
  const [trackB, setTrackB] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (a) fetchSession(a).then(setSessionA).catch(() => setSessionA(null));
    if (b) fetchSession(b).then(setSessionB).catch(() => setSessionB(null));
  }, [a, b]);

  useEffect(() => {
    if (a && lapA != null) fetchTrack(a, lapA).then(setTrackA).catch(() => setTrackA(null));
    if (b && lapB != null) fetchTrack(b, lapB).then(setTrackB).catch(() => setTrackB(null));
    if (!a || !b || lapA == null || lapB == null) return;
    setError(null);
    fetchCrossSessionDeltaT({ session_id: a, lap: lapA }, { session_id: b, lap: lapB })
      .then(setDelta)
      .catch((e) => {
        setDelta(null);
        setError(e.message ?? "Failed to compute delta");
      });
  }, [a, b, lapA, lapB]);

  if (!a || !b) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Pass two session ids as <code>?a=SESSION_A&amp;b=SESSION_B</code>.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 text-sm">
      <h1 className="text-lg font-semibold">Session compare</h1>
      <div className="grid grid-cols-2 gap-4">
        <SidePane label="Reference" session={sessionA} selectedLap={lapA} onSelectLap={setLapA} track={trackA} />
        <SidePane label="Compare" session={sessionB} selectedLap={lapB} onSelectLap={setLapB} track={trackB} />
      </div>
      <div>
        <h2 className="font-semibold mb-1">Delta-t</h2>
        {error && <p className="text-red-400">{error}</p>}
        {delta && (
          <p className="text-muted-foreground">
            {delta.distance_m.length} samples; final Δt ={" "}
            {delta.delta_seconds[delta.delta_seconds.length - 1]?.toFixed(3)} s
          </p>
        )}
        {!delta && !error && <p className="text-muted-foreground">Pick a lap in each session.</p>}
      </div>
    </div>
  );
}

function SidePane({
  label,
  session,
  selectedLap,
  onSelectLap,
  track,
}: {
  label: string;
  session: SessionDetail | null;
  selectedLap: number | null;
  onSelectLap: (n: number) => void;
  track: TrackData | null;
}) {
  if (!session) return <div className="rounded border border-border p-3">Loading…</div>;
  const laps = session.laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  return (
    <div className="rounded border border-border p-3 space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{session.file_name ?? session.id}</div>
      <div className="flex flex-wrap gap-1">
        {laps.map((l) => (
          <button
            type="button"
            key={l.num}
            onClick={() => onSelectLap(l.num)}
            className={`px-1.5 py-0.5 rounded text-xs ${
              selectedLap === l.num
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            L{l.num} · {(l.duration_ms / 1000).toFixed(3)}s
          </button>
        ))}
      </div>
      {track && track.lat.length > 0 && (
        <TrackMap lat={track.lat} lon={track.lon} speed={track.speed} width={340} height={260} />
      )}
    </div>
  );
}
