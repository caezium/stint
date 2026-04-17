"use client";

import { useEffect, useState } from "react";
import {
  fetchDebrief,
  fetchDriverFingerprintStats,
  fetchPerLapFingerprints,
  recomputeDebrief,
  type Debrief,
  type DebriefSessionTrend,
  type DriverFingerprintStats,
  type LapFingerprint,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConsistencyCard } from "@/components/consistency-card";
import { CornerHeatmap } from "@/components/corner-heatmap";
import { Markdown } from "@/components/chat/markdown";
import { ExplainButton } from "@/components/explain-button";
import { CoachingPlanCard } from "@/components/coaching-plan-card";

// ---------------------------------------------------------------------------
// useDebrief hook — shared between the legacy orchestrator component and the
// new split layout on the session detail page. Encapsulates all fetch/polling
// logic so callers get a clean, reactive view of the debrief + history + bench.
// ---------------------------------------------------------------------------

export interface UseDebriefResult {
  debrief: Debrief | null;
  history: LapFingerprint[];
  bench: DriverFingerprintStats;
  loading: boolean;
  error: string | null;
  recomputing: boolean;
  sessionTrend: DebriefSessionTrend | null | undefined;
  recompute: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useDebrief(sessionId: string): UseDebriefResult {
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [history, setHistory] = useState<LapFingerprint[]>([]);
  const [bench, setBench] = useState<DriverFingerprintStats>({});

  async function load() {
    setLoading(true);
    try {
      const d = await fetchDebrief(sessionId);
      setDebrief(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
    fetchPerLapFingerprints(sessionId).then(setHistory);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!debrief?.meta?.driver) return;
    let cancelled = false;
    fetchDriverFingerprintStats(debrief.meta.driver).then((stats) => {
      if (!cancelled) setBench(stats);
    });
    return () => { cancelled = true; };
  }, [debrief?.meta?.driver]);

  // Poll for LLM narrative until ready/failed
  useEffect(() => {
    if (!debrief || debrief.narrative?.status !== "pending") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const next = await fetchDebrief(sessionId);
        if (cancelled) return;
        setDebrief(next);
        if (next.narrative?.status !== "pending") clearInterval(interval);
      } catch { /* keep polling */ }
    }, 3500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, debrief?.narrative?.status]);

  async function recompute() {
    setRecomputing(true);
    setError(null);
    try {
      const next = await recomputeDebrief(sessionId);
      setDebrief(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  const sessionTrend: DebriefSessionTrend | null | undefined =
    debrief?.session_trend ?? debrief?.weather_correlation;

  return {
    debrief,
    history,
    bench,
    loading,
    error,
    recomputing,
    sessionTrend,
    recompute,
    reload: load,
  };
}

interface Props {
  sessionId: string;
}

export function DebriefPanel({ sessionId }: Props) {
  const {
    debrief, history, bench, loading, error, recomputing,
    sessionTrend, recompute,
  } = useDebrief(sessionId);

  async function handleRecompute() {
    await recompute();
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base">Auto-debrief</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Headline coaching, consistency, corner scoring, and driving fingerprint.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>

        {loading && <div className="text-xs text-muted-foreground py-2">Loading…</div>}
        {error && <div className="text-xs text-destructive py-2">{error}</div>}

        {!loading && !error && debrief && (
          <>
            <DebriefHeadline narrative={debrief.narrative} sessionId={sessionId} />

            <CoachingPlanCard sessionId={sessionId} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConsistencyCard consistency={debrief.lap_consistency} />
              <CornerHeatmap corners={debrief.corner_performance} />
            </div>

            {debrief.driving_fingerprint && (
              <DrivingFingerprintCard
                fp={debrief.driving_fingerprint}
                history={history}
                bench={bench}
              />
            )}

            {sessionTrend && <SessionTrendCard insight={sessionTrend} />}

            {debrief._generated_at && (
              <div className="text-[10px] text-muted-foreground text-right">
                Generated {debrief._generated_at}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// T1.1 — Narrative headline
// ---------------------------------------------------------------------------

export function DebriefHeadline({
  narrative,
  sessionId,
}: {
  narrative: Debrief["narrative"];
  sessionId?: string;
}) {
  if (!narrative) return null;

  if (narrative.status === "pending") {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Coach summary
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-3/4 bg-muted/60 rounded animate-pulse" />
          <div className="h-3 w-2/3 bg-muted/50 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-muted/40 rounded animate-pulse" />
        </div>
        <div className="text-[10px] text-muted-foreground/70">
          Stint is reviewing your session…
        </div>
      </div>
    );
  }
  if (narrative.status !== "ready") return null;
  if (!narrative.summary && (!narrative.action_items || narrative.action_items.length === 0)) {
    return null;
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2.5">
      <div className="text-xs uppercase tracking-wide text-primary/80">
        Coach summary
      </div>
      {narrative.summary && (
        <div className="text-sm leading-relaxed">
          <Markdown sessionId={sessionId}>{narrative.summary}</Markdown>
        </div>
      )}
      {narrative.action_items && narrative.action_items.length > 0 && (
        <div>
          <div className="text-xs font-medium text-foreground mb-1">
            Focus for next session
          </div>
          <ul className="text-sm space-y-1 list-disc list-inside marker:text-primary/60">
            {narrative.action_items.slice(0, 5).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driving fingerprint card with sparkline (T2.4) + benchmark bar (T3.4)
// ---------------------------------------------------------------------------

export function DrivingFingerprintCard({
  fp,
  history,
  bench,
}: {
  fp: NonNullable<Debrief["driving_fingerprint"]>;
  history: LapFingerprint[];
  bench: DriverFingerprintStats;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium text-sm">Driving fingerprint</h3>
        <Badge variant="secondary" className="text-[10px]">
          best lap {fp.reference_lap}
        </Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <FingerprintStat
          stat="throttle_smoothness"
          label="Throttle smoothness"
          value={fp.throttle_smoothness}
          format={(v) => v.toFixed(3)}
          history={history.map((h) => h.throttle_smoothness)}
          bench={bench.throttle_smoothness}
          higherIsBetter
        />
        <FingerprintStat
          stat="braking_aggressiveness"
          label="Brake aggressiveness"
          value={fp.braking_aggressiveness}
          format={(v) => v.toFixed(2)}
          history={history.map((h) => h.braking_aggressiveness)}
          bench={bench.braking_aggressiveness}
        />
        <FingerprintStat
          stat="max_brake"
          label="Max brake"
          value={fp.max_brake}
          format={(v) => v.toFixed(1)}
          history={history.map((h) => h.max_brake)}
          bench={bench.max_brake}
        />
        <FingerprintStat
          stat="steering_smoothness"
          label="Steering smoothness"
          value={fp.steering_smoothness}
          format={(v) => v.toFixed(3)}
          history={history.map((h) => h.steering_smoothness)}
          bench={bench.steering_smoothness}
          higherIsBetter
        />
      </div>
    </div>
  );
}

interface StatProps {
  stat: string;
  label: string;
  value: number | undefined;
  format: (v: number) => string;
  history?: (number | null)[];
  bench?: { p25: number | null; p50: number | null; p75: number | null; n: number };
  higherIsBetter?: boolean;
}

function FingerprintStat({ stat, label, value, format, history, bench }: StatProps) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <ExplainButton stat={stat} label={label.toLowerCase()} />
      </div>
      <div className="font-mono text-sm mt-0.5">
        {value != null ? format(value) : "—"}
      </div>
      {history && history.filter((v) => v != null).length > 1 && (
        <Sparkline
          values={history.filter((v): v is number => v != null)}
          highlight={value ?? null}
        />
      )}
      {bench && bench.p25 != null && bench.p75 != null && value != null && (
        <BenchmarkBar
          value={value}
          p25={bench.p25}
          p50={bench.p50 ?? null}
          p75={bench.p75}
          n={bench.n}
        />
      )}
    </div>
  );
}

function Sparkline({ values, highlight }: { values: number[]; highlight: number | null }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80;
  const h = 16;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      className="mt-1 block"
      role="img"
      aria-label="per-lap trend"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="text-muted-foreground/60"
      />
      {highlight != null && (
        <circle
          cx={w}
          cy={h - ((highlight - min) / range) * h}
          r={1.5}
          className="fill-primary"
        />
      )}
    </svg>
  );
}

function BenchmarkBar({
  value,
  p25,
  p50,
  p75,
  n,
}: {
  value: number;
  p25: number;
  p50: number | null;
  p75: number;
  n: number;
}) {
  // Build a [p25-margin, p75+margin] axis so the iqr fills the middle and the
  // value pin shows whether you're below/in/above the band.
  const span = Math.max(p75 - p25, 1e-6);
  const lo = p25 - span * 0.5;
  const hi = p75 + span * 0.5;
  const total = hi - lo;

  function pct(v: number) {
    return Math.max(0, Math.min(100, ((v - lo) / total) * 100));
  }
  const bandLeft = pct(p25);
  const bandWidth = Math.max(2, pct(p75) - pct(p25));
  const valueLeft = pct(value);

  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 rounded bg-muted/60 overflow-hidden">
        <div
          className="absolute inset-y-0 bg-muted/90"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
        />
        {p50 != null && (
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${pct(p50)}%` }}
          />
        )}
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-primary"
          style={{ left: `calc(${valueLeft}% - 1px)` }}
        />
      </div>
      <div className="text-[9px] text-muted-foreground/70 mt-0.5">
        vs your past p25–p75 (n={n})
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T1.8 — renamed Session-trend card (was WeatherInsightCard)
// ---------------------------------------------------------------------------

export function SessionTrendCard({ insight }: { insight: DebriefSessionTrend }) {
  const ctx = insight.weather_context;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-medium text-sm mb-2 flex items-center gap-1">
        Session trend
        <ExplainButton stat="lap_trend_slope_ms_per_lap" label="session trend" />
      </h3>
      <p className="text-sm">{insight.insight}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>
          slope: <span className="font-mono">{insight.lap_trend_slope_ms_per_lap}ms/lap</span>
        </span>
        <span>
          r: <span className="font-mono">{insight.lap_trend_r}</span>
        </span>
        {ctx.weather && <span>· weather: {ctx.weather}</span>}
        {ctx.track_temp != null && <span>· track {ctx.track_temp}°C</span>}
        {ctx.air_temp != null && <span>· air {ctx.air_temp}°C</span>}
      </div>
    </div>
  );
}
