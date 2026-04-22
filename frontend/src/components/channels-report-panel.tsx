"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchChannelsReport,
  fetchSession,
  type ChannelsReportData,
  type ChannelStatKey,
  type SessionDetail,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  sessionId: string;
}

const STAT_LABEL: Record<ChannelStatKey, string> = {
  min: "min",
  max: "max",
  avg: "avg",
  p50: "p50",
  p90: "p90",
  p99: "p99",
  std: "σ",
  count: "N",
};

const DEFAULT_CHANNELS = ["RPM", "GPS Speed", "Throttle", "Brake"];
const DEFAULT_STATS: ChannelStatKey[] = ["min", "max", "avg", "p90"];

function fmtStat(v: number | null | undefined, stat: ChannelStatKey): string {
  if (v == null) return "—";
  if (stat === "count") return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * RaceStudio-3-parity Channels Report. Per-lap aggregate statistics for a
 * user-picked set of channels and stats, rendered as a compact table.
 * (Phase 14.2)
 */
export function ChannelsReportPanel({ sessionId }: Props) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [channels, setChannels] = useState<string[]>(DEFAULT_CHANNELS);
  const [stats, setStats] = useState<ChannelStatKey[]>(DEFAULT_STATS);
  const [data, setData] = useState<ChannelsReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    fetchSession(sessionId).then(setSession).catch(() => setSession(null));
  }, [sessionId]);

  // Narrow default channels to what the session actually has.
  useEffect(() => {
    if (!session) return;
    const present = new Set(session.channels.map((c) => c.name));
    const filtered = channels.filter((c) => present.has(c));
    if (filtered.length === 0) {
      const firstFour = session.channels
        .filter((c) => c.category !== "Position" && c.sample_count > 10)
        .slice(0, 4)
        .map((c) => c.name);
      if (firstFour.length) setChannels(firstFour);
    } else if (filtered.length !== channels.length) {
      setChannels(filtered);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (channels.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchChannelsReport(sessionId, channels, stats)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : "Failed")
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId, channels, stats]);

  const availableChannels = useMemo(
    () =>
      (session?.channels ?? [])
        .filter((c) => c.category !== "Position" && c.sample_count > 10)
        .map((c) => c.name),
    [session]
  );

  function toggleChannel(name: string) {
    setChannels((cs) =>
      cs.includes(name) ? cs.filter((c) => c !== name) : [...cs, name]
    );
  }

  function toggleStat(s: ChannelStatKey) {
    setStats((ss) =>
      ss.includes(s) ? ss.filter((x) => x !== s) : [...ss, s]
    );
  }

  if (!session) return null;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Channels report</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Per-lap min / max / average / percentile for selected channels.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {pickerOpen ? "Done" : "Edit"}
          </Button>
        </div>

        {pickerOpen && (
          <div className="px-5 py-3 border-b border-border space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Channels
              </div>
              <div className="flex flex-wrap gap-1">
                {availableChannels.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    className={`px-2 py-0.5 text-[11px] rounded-full border ${
                      channels.includes(c)
                        ? "bg-primary/20 border-primary/40 text-foreground"
                        : "border-border/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Stats
              </div>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(STAT_LABEL) as ChannelStatKey[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStat(s)}
                    className={`px-2 py-0.5 text-[11px] rounded-full border ${
                      stats.includes(s)
                        ? "bg-primary/20 border-primary/40 text-foreground"
                        : "border-border/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {STAT_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 py-3 text-xs text-destructive">{error}</div>
        )}

        {loading && !data && (
          <div className="px-5 py-3 text-xs text-muted-foreground">
            Computing stats…
          </div>
        )}

        {data && data.laps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="bg-muted/30 border-b border-border/40">
                  <th
                    rowSpan={2}
                    className="text-left px-3 py-1.5 font-medium text-muted-foreground w-16 align-bottom"
                  >
                    Lap
                  </th>
                  <th
                    rowSpan={2}
                    className="text-right px-3 py-1.5 font-medium text-muted-foreground align-bottom"
                  >
                    Time
                  </th>
                  {data.channels.map((c) => (
                    <th
                      key={c}
                      colSpan={data.stats.length}
                      className="text-center px-3 py-1 font-medium text-muted-foreground border-l border-border/40"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/20 border-b border-border/40">
                  {data.channels.map((c) =>
                    data.stats.map((s, i) => (
                      <th
                        key={`${c}-${s}`}
                        className={`text-right px-2 py-1 font-normal text-muted-foreground/80 text-[10px] ${
                          i === 0 ? "border-l border-border/40" : ""
                        }`}
                      >
                        {STAT_LABEL[s]}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {data.laps.map((lap) => (
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
                    <td className="px-3 py-1.5 text-right font-mono text-foreground">
                      {lap.duration_ms > 0 ? formatLapTime(lap.duration_ms) : "—"}
                    </td>
                    {data.channels.map((c) =>
                      data.stats.map((s, i) => {
                        const v = lap.cells?.[c]?.[s] ?? null;
                        return (
                          <td
                            key={`${c}-${s}`}
                            className={`px-2 py-1.5 text-right font-mono text-foreground ${
                              i === 0 ? "border-l border-border/40" : ""
                            }`}
                          >
                            {fmtStat(v, s)}
                          </td>
                        );
                      })
                    )}
                  </tr>
                ))}
                {/* session-wide rollup */}
                <tr className="bg-muted/40 border-t-2 border-border/60">
                  <td className="px-3 py-1.5 font-medium">Session</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground/70">—</td>
                  {data.channels.map((c) =>
                    data.stats.map((s, i) => {
                      const v = data.session_wide?.[c]?.[s] ?? null;
                      return (
                        <td
                          key={`sw-${c}-${s}`}
                          className={`px-2 py-1.5 text-right font-mono text-muted-foreground ${
                            i === 0 ? "border-l border-border/40" : ""
                          }`}
                        >
                          {fmtStat(v, s)}
                        </td>
                      );
                    })
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {data && data.laps.length === 0 && (
          <div className="px-5 py-6 text-xs text-muted-foreground text-center">
            No laps with aggregate data.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
