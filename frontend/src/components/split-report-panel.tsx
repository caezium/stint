"use client";

import { useEffect, useState } from "react";
import { fetchSplitReport, type SplitReportData } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  sessionId: string;
}

function fmt(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  const s = ms / 1000;
  return s >= 60 ? formatLapTime(ms) : `${s.toFixed(3)}s`;
}

function splitTypeColor(type: string): string {
  switch (type) {
    case "corner1":
      return "bg-amber-400";
    case "corner2":
      return "bg-orange-400";
    case "straight":
      return "bg-sky-400";
    case "chicane":
      return "bg-pink-400";
    default:
      return "bg-muted-foreground/50";
  }
}

/**
 * RaceStudio-3-parity Split Report table. Renders all racing laps × all
 * sectors with best-in-column highlighting and rolling/theoretical rollups.
 * (Phase 14.1)
 */
export function SplitReportPanel({ sessionId }: Props) {
  const [data, setData] = useState<SplitReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSplitReport(sessionId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) =>
        !cancelled && setError(e instanceof Error ? e.message : "Failed")
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 text-xs text-muted-foreground">
          Loading split report…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-5 text-xs text-destructive">{error}</CardContent>
      </Card>
    );
  }
  if (!data || data.sectors.length === 0 || data.laps.length === 0) {
    return null;
  }

  const { sectors, laps, best_rolling_lap, theoretical_best_ms, rolling_vs_theoretical_ms } = data;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Split report</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Per-lap × per-sector times. Best-in-column is bold green.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {best_rolling_lap && (
              <span>
                Rolling best{" "}
                <span className="font-mono text-green-400">
                  {fmt(best_rolling_lap.duration_ms)}
                </span>{" "}
                <span className="text-muted-foreground/70">
                  (L{best_rolling_lap.num})
                </span>
              </span>
            )}
            {theoretical_best_ms != null && (
              <span>
                Theoretical{" "}
                <span className="font-mono text-emerald-400">
                  {fmt(theoretical_best_ms)}
                </span>
              </span>
            )}
            {rolling_vs_theoretical_ms != null && rolling_vs_theoretical_ms > 0 && (
              <span className="text-amber-400">
                +{(rolling_vs_theoretical_ms / 1000).toFixed(3)}s gap
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-muted/30 border-b border-border/40">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground w-14">Lap</th>
                {sectors.map((s) => (
                  <th
                    key={s.sector_num}
                    className="text-right px-3 py-1.5 font-medium text-muted-foreground"
                    title={s.type || undefined}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      {s.type && (
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${splitTypeColor(s.type)}`}
                          aria-hidden
                        />
                      )}
                      {s.label || `S${s.sector_num}`}
                    </span>
                  </th>
                ))}
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Lap time</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((lap) => {
                const isBestLap =
                  best_rolling_lap != null && lap.num === best_rolling_lap.num;
                return (
                  <tr
                    key={lap.num}
                    className={`border-b border-border/30 hover:bg-muted/20 ${
                      lap.is_pit_lap ? "opacity-40" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <span className="font-medium">L{lap.num}</span>
                      {lap.is_pit_lap && (
                        <Badge variant="secondary" className="ml-2 text-[9px]">pit</Badge>
                      )}
                    </td>
                    {lap.splits.map((v, idx) => {
                      const isBest = lap.best_of_session_mask[idx];
                      return (
                        <td
                          key={idx}
                          className={`px-3 py-1.5 text-right font-mono ${
                            isBest
                              ? "text-green-400 font-semibold"
                              : v != null
                                ? "text-foreground"
                                : "text-muted-foreground/50"
                          }`}
                        >
                          {fmt(v)}
                        </td>
                      );
                    })}
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        isBestLap
                          ? "text-green-400 font-semibold"
                          : "text-foreground"
                      }`}
                    >
                      {fmt(lap.duration_ms)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
