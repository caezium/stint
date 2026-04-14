"use client";

import { useEffect, useState } from "react";
import { fetchChannelData, type Channel } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ChannelReportProps {
  sessionId: string;
  channels: Channel[];
}

interface ChannelStats {
  name: string;
  units: string;
  min: number;
  max: number;
  avg: number;
  range: number;
}

export function ChannelReport({ sessionId, channels }: ChannelReportProps) {
  const [stats, setStats] = useState<ChannelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      const results: ChannelStats[] = [];

      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        try {
          const data = await fetchChannelData(sessionId, ch.name);
          const vals = data.values.filter((v) => isFinite(v));
          if (vals.length === 0) continue;

          const min = Math.min(...vals);
          const max = Math.max(...vals);
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          results.push({
            name: ch.name,
            units: ch.units,
            min,
            max,
            avg,
            range: max - min,
          });
        } catch {
          // skip channels that fail to load
        }
        if (cancelled) return;
        setProgress(Math.round(((i + 1) / channels.length) * 100));
      }

      if (!cancelled) {
        setStats(results);
        setLoading(false);
      }
    }

    compute();
    return () => {
      cancelled = true;
    };
  }, [sessionId, channels]);

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">
          Computing channel statistics... {progress}%
        </p>
        <div className="w-full bg-zinc-800 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No channel data available
      </div>
    );
  }

  const fmt = (v: number, decimals = 2) =>
    isFinite(v) ? v.toFixed(decimals) : "—";

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 bg-zinc-900/50">
            <TableHead className="text-zinc-400">Channel</TableHead>
            <TableHead className="text-zinc-400">Units</TableHead>
            <TableHead className="text-zinc-400 text-right">Min</TableHead>
            <TableHead className="text-zinc-400 text-right">Max</TableHead>
            <TableHead className="text-zinc-400 text-right">Avg</TableHead>
            <TableHead className="text-zinc-400 text-right">Range</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((s) => (
            <TableRow key={s.name} className="border-zinc-800">
              <TableCell className="font-medium text-sm text-zinc-200">
                {s.name}
              </TableCell>
              <TableCell className="text-sm text-zinc-400">{s.units || "—"}</TableCell>
              <TableCell className="font-mono text-sm text-right text-zinc-300">
                {fmt(s.min)}
              </TableCell>
              <TableCell className="font-mono text-sm text-right text-zinc-300">
                {fmt(s.max)}
              </TableCell>
              <TableCell className="font-mono text-sm text-right text-zinc-300">
                {fmt(s.avg)}
              </TableCell>
              <TableCell className="font-mono text-sm text-right text-zinc-300">
                {fmt(s.range)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
