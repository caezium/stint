"use client";

import type { Lap } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SectorChartProps {
  laps: Lap[];
}

export function SectorChart({ laps }: SectorChartProps) {
  const validLaps = laps.filter((l) => l.num > 0 && l.duration_ms > 0);

  if (validLaps.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No lap data available
      </div>
    );
  }

  const bestTime = Math.min(...validLaps.map((l) => l.duration_ms));
  const worstTime = Math.max(...validLaps.map((l) => l.duration_ms));

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 bg-zinc-900/50">
            <TableHead className="text-zinc-400 w-16">Lap</TableHead>
            <TableHead className="text-zinc-400">Time</TableHead>
            <TableHead className="text-zinc-400">Delta</TableHead>
            <TableHead className="text-zinc-400 text-right">% of Best</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {validLaps.map((lap) => {
            const delta = lap.duration_ms - bestTime;
            const isBest = lap.duration_ms === bestTime;
            const isWorst = lap.duration_ms === worstTime && validLaps.length > 1;
            const pctOfBest =
              bestTime > 0 ? ((lap.duration_ms / bestTime) * 100).toFixed(1) : "—";

            return (
              <TableRow
                key={lap.num}
                className={`border-zinc-800 ${
                  isBest
                    ? "bg-green-500/10"
                    : isWorst
                      ? "bg-red-500/5"
                      : ""
                }`}
              >
                <TableCell className="font-mono text-sm text-zinc-300">
                  {lap.num}
                </TableCell>
                <TableCell
                  className={`font-mono text-sm ${
                    isBest ? "text-green-400 font-semibold" : "text-zinc-200"
                  }`}
                >
                  {formatLapTime(lap.duration_ms)}
                </TableCell>
                <TableCell
                  className={`font-mono text-sm ${
                    isBest
                      ? "text-green-400"
                      : isWorst
                        ? "text-red-400"
                        : "text-zinc-400"
                  }`}
                >
                  {isBest ? "BEST" : `+${(delta / 1000).toFixed(3)}`}
                </TableCell>
                <TableCell
                  className={`font-mono text-sm text-right ${
                    isBest ? "text-green-400" : "text-zinc-400"
                  }`}
                >
                  {pctOfBest}%
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
