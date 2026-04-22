"use client";

import { useEffect, useState } from "react";
import { fetchCorners, detectCornersForSession, type Corner } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Corners panel (Phase 26.1). Lists detected corners for the session's
 * representative lap with peak g, entry/min/exit speed, and direction.
 */
export function CornersPanel({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<Corner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCorners(sessionId)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  async function rerun() {
    setBusy(true);
    try {
      const r = await detectCornersForSession(sessionId);
      setRows(r.corners);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Corners</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Detected from the fastest non-pit lap by lateral-g hysteresis.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={rerun} disabled={busy}>
            {busy ? "Detecting…" : "Re-detect"}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No corners detected for this session yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-muted/30 border-b border-border/40">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">#</th>
                  <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Dir</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Peak g</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Entry</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Min</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Exit</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Length</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.corner_num}
                    className="border-b border-border/30 hover:bg-muted/20"
                  >
                    <td className="px-3 py-1.5 font-medium">C{c.corner_num}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          c.direction === "right"
                            ? "text-sky-400"
                            : "text-amber-400"
                        }
                      >
                        {c.direction}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {c.peak_lat_g > 0 ? "+" : ""}
                      {c.peak_lat_g.toFixed(2)}g
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {c.entry_speed.toFixed(1)} km/h
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-400">
                      {c.min_speed.toFixed(1)} km/h
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {c.exit_speed.toFixed(1)} km/h
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {(c.end_distance_m - c.start_distance_m).toFixed(0)} m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
