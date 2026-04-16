"use client";

import { type DebriefLapConsistency } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface Props {
  consistency: DebriefLapConsistency;
}

function covLabel(cov: number | null): { label: string; color: string } {
  if (cov == null) return { label: "—", color: "text-muted-foreground" };
  const pct = cov * 100;
  if (pct < 1.0) return { label: "Elite", color: "text-green-400" };
  if (pct < 2.0) return { label: "Strong", color: "text-green-300" };
  if (pct < 3.0) return { label: "Solid", color: "text-amber-300" };
  if (pct < 5.0) return { label: "Variable", color: "text-amber-400" };
  return { label: "Inconsistent", color: "text-red-400" };
}

export function ConsistencyCard({ consistency }: Props) {
  const covPct = consistency.coefficient_of_variation != null
    ? consistency.coefficient_of_variation * 100
    : null;
  const rating = covLabel(consistency.coefficient_of_variation);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium text-sm">Lap consistency</h3>
        <span className={`text-xs font-medium ${rating.color}`}>{rating.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
        <div className="text-muted-foreground text-xs">Clean laps</div>
        <div className="text-right font-mono text-sm">
          {consistency.clean_lap_count}
          <span className="text-muted-foreground"> / {consistency.lap_count}</span>
        </div>

        <div className="text-muted-foreground text-xs">Best</div>
        <div className="text-right font-mono text-sm text-green-400">
          {consistency.best_ms != null ? formatLapTime(consistency.best_ms) : "—"}
        </div>

        <div className="text-muted-foreground text-xs">Mean (clean)</div>
        <div className="text-right font-mono text-sm">
          {consistency.mean_ms != null ? formatLapTime(consistency.mean_ms) : "—"}
        </div>

        <div className="text-muted-foreground text-xs">Stddev</div>
        <div className="text-right font-mono text-sm">
          {consistency.stddev_ms != null ? `${(consistency.stddev_ms / 1000).toFixed(3)}s` : "—"}
        </div>

        <div className="text-muted-foreground text-xs">COV</div>
        <div className="text-right font-mono text-sm">
          {covPct != null ? `${covPct.toFixed(2)}%` : "—"}
        </div>

        <div className="text-muted-foreground text-xs">Best streak</div>
        <div className="text-right font-mono text-sm">
          {consistency.best_streak} laps
        </div>
      </div>
    </div>
  );
}
