"use client";

import type { Lap } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface Props {
  laps: Lap[];
}

/**
 * Horizontal bar viz of each lap's delta-to-best. Bars grow up from a zero
 * line (the best lap). Out-lap and sub-zero laps are muted. Lets the driver
 * see session pace shape at a glance — was it a consistent stint, did it
 * slow down in the middle, is there one outlier, etc.
 */
export function LapDeltaBars({ laps }: Props) {
  const racing = laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  if (racing.length === 0) return null;

  const bestMs = Math.min(...racing.map((l) => l.duration_ms));
  // Cap the bar at 15% slower than best so one bad out lap doesn't squash
  // the rest. Laps above the cap render as full-height.
  const capMs = bestMs * 1.15;
  const denom = Math.max(1, capMs - bestMs);

  const H = 84; // chart height in px
  const barW = Math.max(10, Math.floor(680 / Math.max(racing.length, 8)));

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Lap pace</h3>
        <div className="text-[10px] text-muted-foreground">
          ∆ to best lap — shorter bar = faster
        </div>
      </div>
      <div className="relative" style={{ height: H }}>
        {/* Zero line */}
        <div
          className="absolute left-0 right-0 top-0 border-t border-dashed border-emerald-500/40"
          title={`Best: ${formatLapTime(bestMs)}`}
        />
        <div className="flex items-start gap-1 h-full">
          {racing.map((lap) => {
            const delta = lap.duration_ms - bestMs;
            const ratio = Math.min(1, Math.max(0, delta / denom));
            const h = Math.max(2, Math.round(ratio * H));
            const isBest = lap.duration_ms === bestMs;
            const overCap = lap.duration_ms > capMs;
            return (
              <div
                key={lap.num}
                title={`Lap ${lap.num}: ${formatLapTime(lap.duration_ms)}${
                  isBest ? " (best)" : ` · +${(delta / 1000).toFixed(3)}s`
                }`}
                className="flex flex-col items-center gap-0.5 group relative"
                style={{ width: barW }}
              >
                <div
                  className={`w-full rounded-sm transition-colors ${
                    isBest
                      ? "bg-emerald-500/80"
                      : overCap
                        ? "bg-red-500/40 hover:bg-red-500/60"
                        : ratio < 0.3
                          ? "bg-emerald-500/40 hover:bg-emerald-500/60"
                          : ratio < 0.7
                            ? "bg-amber-500/40 hover:bg-amber-500/60"
                            : "bg-red-500/40 hover:bg-red-500/60"
                  }`}
                  style={{ height: h }}
                />
                <div className="text-[9px] text-muted-foreground/60 mt-0.5 font-mono">
                  {lap.num}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
