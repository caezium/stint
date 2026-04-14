"use client";

import { useEffect, useState } from "react";
import { useLapStore } from "@/stores/lap-store";
import { fetchStats, type ChannelStats } from "@/lib/api";

interface StatsPanelProps {
  sessionId: string;
  channels: string[];
  height?: number;
}

export function StatsPanel({
  sessionId,
  channels,
  height = 260,
}: StatsPanelProps) {
  const { refLap, altLap } = useLapStore();
  const [refStats, setRefStats] = useState<Record<string, ChannelStats> | null>(
    null
  );
  const [altStats, setAltStats] = useState<Record<string, ChannelStats> | null>(
    null
  );

  useEffect(() => {
    if (!refLap || channels.length === 0) {
      setRefStats(null);
      return;
    }
    fetchStats(sessionId, channels, refLap.num)
      .then(setRefStats)
      .catch(() => setRefStats(null));
  }, [sessionId, channels, refLap]);

  useEffect(() => {
    if (!altLap || channels.length === 0) {
      setAltStats(null);
      return;
    }
    fetchStats(sessionId, channels, altLap.num)
      .then(setAltStats)
      .catch(() => setAltStats(null));
  }, [sessionId, channels, altLap]);

  if (!refLap) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Select a lap to view statistics
      </div>
    );
  }

  if (!refStats) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Loading stats...
      </div>
    );
  }

  const statKeys: (keyof ChannelStats)[] = [
    "min",
    "max",
    "avg",
    "stdev",
    "p5",
    "p50",
    "p95",
  ];
  const statLabels: Record<string, string> = {
    min: "Min",
    max: "Max",
    avg: "Avg",
    stdev: "StDev",
    p5: "P5",
    p50: "P50",
    p95: "P95",
  };

  const showAlt = altLap && altStats;

  return (
    <div
      className="overflow-auto bg-[#0c0c0c] rounded-lg"
      style={{ maxHeight: height }}
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium sticky left-0 bg-[#0c0c0c]">
              Channel
            </th>
            {showAlt && (
              <th className="px-2 py-1.5 text-muted-foreground font-medium">
                Lap
              </th>
            )}
            {statKeys.map((k) => (
              <th
                key={k}
                className="text-right px-2 py-1.5 text-muted-foreground font-medium"
              >
                {statLabels[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => {
            const ref = refStats[ch];
            const alt = altStats?.[ch];
            if (!ref) return null;

            return (
              <StatsRows
                key={ch}
                channel={ch}
                refLapNum={refLap.num}
                refStats={ref}
                altLapNum={altLap?.num}
                altStats={alt ?? null}
                statKeys={statKeys}
                showAlt={!!showAlt}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatsRows({
  channel,
  refLapNum,
  refStats,
  altLapNum,
  altStats,
  statKeys,
  showAlt,
}: {
  channel: string;
  refLapNum: number;
  refStats: ChannelStats;
  altLapNum?: number;
  altStats: ChannelStats | null;
  statKeys: (keyof ChannelStats)[];
  showAlt: boolean;
}) {
  return (
    <>
      <tr className="border-b border-white/5 hover:bg-white/5">
        <td
          className="px-2 py-1 font-medium text-white/90 sticky left-0 bg-[#0c0c0c]"
          rowSpan={showAlt && altStats ? 2 : 1}
        >
          {channel}
        </td>
        {showAlt && (
          <td className="px-2 py-1 text-center text-red-400 font-mono">
            L{refLapNum}
          </td>
        )}
        {statKeys.map((k) => (
          <td key={k} className="text-right px-2 py-1 font-mono text-white/80">
            {formatStat(refStats[k] as number)}
          </td>
        ))}
      </tr>
      {showAlt && altStats && (
        <tr className="border-b border-white/5 hover:bg-white/5">
          <td className="px-2 py-1 text-center text-blue-400 font-mono">
            L{altLapNum}
          </td>
          {statKeys.map((k) => {
            const refVal = refStats[k] as number;
            const altVal = altStats[k] as number;
            const isBetter =
              k === "min" || k === "stdev" ? altVal < refVal : altVal > refVal;
            return (
              <td
                key={k}
                className={`text-right px-2 py-1 font-mono ${
                  k === "avg" || k === "max" || k === "min"
                    ? isBetter
                      ? "text-green-400"
                      : "text-white/80"
                    : "text-white/80"
                }`}
              >
                {formatStat(altVal)}
              </td>
            );
          })}
        </tr>
      )}
    </>
  );
}

function formatStat(val: number): string {
  if (Math.abs(val) >= 1000) return val.toFixed(0);
  if (Math.abs(val) >= 100) return val.toFixed(1);
  if (Math.abs(val) >= 1) return val.toFixed(2);
  return val.toFixed(3);
}
