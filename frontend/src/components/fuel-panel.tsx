"use client";

import { useEffect, useState } from "react";
import { fetchFuelSummary, type FuelSummary } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Fuel panel (Phase 26.3). Shows per-lap fuel deltas and a laps-remaining
 * estimate based on mean clean-lap consumption. Silently absent when the
 * session has no Fuel Level channel.
 */
export function FuelPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<FuelSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchFuelSummary(sessionId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading || !data || !data.has_fuel_channel) return null;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-sm">Fuel</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Derived from the <code>{data.channel}</code> channel.
            </p>
          </div>
          {data.laps_remaining != null && (
            <div className="text-sm">
              <span className="text-muted-foreground">Laps remaining: </span>
              <span className="font-mono font-semibold text-emerald-400">
                ≈ {data.laps_remaining}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat
            label="Current level"
            value={
              data.current_level != null
                ? `${data.current_level.toFixed(2)} L`
                : "—"
            }
          />
          <Stat
            label="Avg Δ / lap"
            value={
              data.avg_delta_per_lap != null
                ? `${data.avg_delta_per_lap.toFixed(3)} L`
                : "—"
            }
          />
          <Stat label="Laps logged" value={String(data.per_lap.length)} />
          <Stat
            label="Total used"
            value={
              data.per_lap[0]?.start_level != null &&
              data.per_lap[data.per_lap.length - 1]?.end_level != null
                ? `${(
                    (data.per_lap[0]!.start_level as number) -
                    (data.per_lap[data.per_lap.length - 1]!.end_level as number)
                  ).toFixed(2)} L`
                : "—"
            }
          />
        </div>

        <div className="max-h-[240px] overflow-y-auto border border-border/40 rounded">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-muted/30 border-b border-border/40 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Lap</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Start</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">End</th>
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.per_lap.map((p) => (
                <tr
                  key={p.lap_num}
                  className={`border-b border-border/30 ${p.is_pit_lap ? "opacity-50" : ""}`}
                >
                  <td className="px-3 py-1.5">
                    L{p.lap_num}
                    {p.is_pit_lap && (
                      <span className="ml-1 text-[10px] text-amber-400">pit</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {p.start_level != null ? `${p.start_level.toFixed(2)} L` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {p.end_level != null ? `${p.end_level.toFixed(2)} L` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-400">
                    {p.delta != null ? `−${p.delta.toFixed(3)} L` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
