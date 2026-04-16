"use client";

import { type DebriefCornerPerformance } from "@/lib/api";

interface Props {
  corners: DebriefCornerPerformance[];
}

function scoreColor(score: number): string {
  // 0 → red, 50 → amber, 100 → green — smooth HSL interpolation
  const clamped = Math.max(0, Math.min(100, score));
  // hue: 0 (red) → 120 (green) scaled to 0..100
  const hue = (clamped / 100) * 120;
  return `hsl(${hue} 70% 45%)`;
}

export function CornerHeatmap({ corners }: Props) {
  if (corners.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-medium text-sm mb-2">Corner performance</h3>
        <p className="text-xs text-muted-foreground">
          No sector data yet. Auto-detect sectors first to see per-corner
          consistency scores.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-medium text-sm">Corner performance</h3>
        <span className="text-xs text-muted-foreground">
          score = consistency × closeness to best
        </span>
      </div>
      <div className="space-y-1.5">
        {corners.map((c) => (
          <div key={c.sector_num} className="flex items-center gap-3">
            <div className="w-8 text-xs text-muted-foreground font-mono">
              S{c.sector_num}
            </div>
            <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
              <div
                className="h-full transition-all"
                style={{
                  width: `${c.score}%`,
                  background: scoreColor(c.score),
                }}
              />
              <div className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-foreground/80">
                {c.score.toFixed(0)} · Δ{c.delta_to_best_pct.toFixed(1)}% · σ{c.cov_pct.toFixed(1)}%
              </div>
            </div>
            <div className="w-20 text-right font-mono text-[11px] text-muted-foreground">
              best {(c.best_ms / 1000).toFixed(3)}s
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
