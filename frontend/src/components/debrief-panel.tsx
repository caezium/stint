"use client";

import { useEffect, useState } from "react";
import {
  fetchDebrief,
  recomputeDebrief,
  type Debrief,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConsistencyCard } from "@/components/consistency-card";
import { CornerHeatmap } from "@/components/corner-heatmap";

interface Props {
  sessionId: string;
}

export function DebriefPanel({ sessionId }: Props) {
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDebrief(sessionId)
      .then((d) => {
        if (!cancelled) {
          setDebrief(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleRecompute() {
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

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base">Auto-debrief</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Consistency, corner scoring, and driving fingerprint.
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

        {loading && (
          <div className="text-xs text-muted-foreground py-2">Loading…</div>
        )}

        {error && (
          <div className="text-xs text-destructive py-2">{error}</div>
        )}

        {!loading && !error && debrief && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ConsistencyCard consistency={debrief.lap_consistency} />
              <CornerHeatmap corners={debrief.corner_performance} />
            </div>

            {debrief.driving_fingerprint && (
              <DrivingFingerprintCard fp={debrief.driving_fingerprint} />
            )}

            {debrief.weather_correlation && (
              <WeatherInsightCard insight={debrief.weather_correlation} />
            )}

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

function DrivingFingerprintCard({
  fp,
}: {
  fp: NonNullable<Debrief["driving_fingerprint"]>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium text-sm">Driving fingerprint</h3>
        <Badge variant="secondary" className="text-[10px]">
          lap {fp.reference_lap}
        </Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <FingerprintStat
          label="Throttle smoothness"
          value={fp.throttle_smoothness}
          format={(v) => v.toFixed(3)}
          hint="higher = smoother"
        />
        <FingerprintStat
          label="Brake aggressiveness"
          value={fp.braking_aggressiveness}
          format={(v) => v.toFixed(2)}
          hint="peak d/dt"
        />
        <FingerprintStat
          label="Max brake"
          value={fp.max_brake}
          format={(v) => v.toFixed(1)}
        />
        <FingerprintStat
          label="Steering smoothness"
          value={fp.steering_smoothness}
          format={(v) => v.toFixed(3)}
          hint="higher = smoother"
        />
      </div>
    </div>
  );
}

function FingerprintStat({
  label,
  value,
  format,
  hint,
}: {
  label: string;
  value: number | undefined;
  format: (v: number) => string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-0.5">
        {value != null ? format(value) : "—"}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground/60">{hint}</div>}
    </div>
  );
}

function WeatherInsightCard({
  insight,
}: {
  insight: NonNullable<Debrief["weather_correlation"]>;
}) {
  const ctx = insight.weather_context;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-medium text-sm mb-2">Session trend</h3>
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
