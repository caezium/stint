"use client";

import { useState, useEffect, useMemo } from "react";
import { autoDetectSectors, fetchSectors, type SectorsResult } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface SectorAnalysisProps {
  sessionId: string;
  height?: number;
}

export function SectorAnalysis({ sessionId, height }: SectorAnalysisProps) {
  const [data, setData] = useState<SectorsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numSectors, setNumSectors] = useState(3);

  // Try loading existing sectors first
  useEffect(() => {
    fetchSectors(sessionId)
      .then((d) => {
        if (d.sectors.length > 0) setData(d);
      })
      .catch(() => {});
  }, [sessionId]);

  const handleAutoDetect = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await autoDetectSectors(sessionId, numSectors);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to detect sectors");
    } finally {
      setLoading(false);
    }
  };

  // Compute best per-sector and per-lap totals
  const analysis = useMemo(() => {
    if (!data || data.sectors.length === 0) return null;

    const sectorNums = data.sectors.map((s) => s.sector_num);
    const lapNums = [...new Set(data.sector_times.map((t) => t.lap_num))].sort(
      (a, b) => a - b
    );

    // Build lookup: { lapNum: { sectorNum: duration_ms } }
    const lookup: Record<number, Record<number, number>> = {};
    for (const t of data.sector_times) {
      if (!lookup[t.lap_num]) lookup[t.lap_num] = {};
      lookup[t.lap_num][t.sector_num] = t.duration_ms;
    }

    // Best per sector
    const bestSector: Record<number, number> = {};
    for (const sn of sectorNums) {
      const times = data.sector_times
        .filter((t) => t.sector_num === sn)
        .map((t) => t.duration_ms);
      if (times.length > 0) bestSector[sn] = Math.min(...times);
    }

    // Best total lap (among laps with all sectors)
    let bestTotal = Infinity;
    for (const ln of lapNums) {
      const total = sectorNums.reduce(
        (sum, sn) => sum + (lookup[ln]?.[sn] ?? Infinity),
        0
      );
      if (total < bestTotal) bestTotal = total;
    }

    const theoreticalBest = Object.values(bestSector).reduce(
      (a, b) => a + b,
      0
    );

    return { sectorNums, lapNums, lookup, bestSector, bestTotal, theoreticalBest };
  }, [data]);

  if (!data || !analysis) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 bg-[#0c0c0c] rounded-lg text-sm"
        style={{ height: height ?? 300 }}
      >
        <p className="text-muted-foreground">
          No sector data yet. Auto-detect sectors from GPS data.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Sectors:</label>
          <select
            value={numSectors}
            onChange={(e) => setNumSectors(Number(e.target.value))}
            className="bg-muted border-none rounded px-2 py-1 text-xs"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={handleAutoDetect}
            disabled={loading}
            className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Detecting..." : "Auto-Detect"}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    );
  }

  const { sectorNums, lapNums, lookup, bestSector, bestTotal, theoreticalBest } =
    analysis;

  return (
    <div
      className="overflow-auto rounded-lg border border-zinc-800"
      style={{ maxHeight: height ?? 400 }}
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
          <tr className="border-b border-zinc-800">
            <th className="text-left px-3 py-2 text-zinc-400 font-medium">
              Lap
            </th>
            {sectorNums.map((sn) => (
              <th
                key={sn}
                className="text-right px-3 py-2 text-zinc-400 font-medium"
              >
                S{sn}
              </th>
            ))}
            <th className="text-right px-3 py-2 text-zinc-400 font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lapNums.map((ln) => {
            const lapTotal = sectorNums.reduce(
              (sum, sn) => sum + (lookup[ln]?.[sn] ?? 0),
              0
            );
            const isBestLap = lapTotal === bestTotal;

            return (
              <tr
                key={ln}
                className={`border-b border-zinc-800/50 ${
                  isBestLap ? "bg-green-500/10" : ""
                }`}
              >
                <td className="px-3 py-1.5 font-mono text-zinc-300">{ln}</td>
                {sectorNums.map((sn) => {
                  const ms = lookup[ln]?.[sn];
                  if (ms === undefined)
                    return (
                      <td
                        key={sn}
                        className="text-right px-3 py-1.5 text-zinc-600"
                      >
                        --
                      </td>
                    );
                  const isBestSector = ms === bestSector[sn];
                  return (
                    <td
                      key={sn}
                      className={`text-right px-3 py-1.5 font-mono ${
                        isBestSector
                          ? "text-purple-400 font-semibold"
                          : "text-zinc-300"
                      }`}
                    >
                      {formatLapTime(ms)}
                    </td>
                  );
                })}
                <td
                  className={`text-right px-3 py-1.5 font-mono ${
                    isBestLap
                      ? "text-green-400 font-semibold"
                      : "text-zinc-300"
                  }`}
                >
                  {formatLapTime(lapTotal)}
                </td>
              </tr>
            );
          })}

          {/* Theoretical best row */}
          <tr className="border-t-2 border-zinc-700 bg-purple-500/10">
            <td className="px-3 py-2 text-purple-400 font-medium">
              Theoretical
            </td>
            {sectorNums.map((sn) => (
              <td
                key={sn}
                className="text-right px-3 py-2 font-mono text-purple-400 font-semibold"
              >
                {bestSector[sn] ? formatLapTime(bestSector[sn]) : "--"}
              </td>
            ))}
            <td className="text-right px-3 py-2 font-mono text-purple-400 font-bold">
              {formatLapTime(theoreticalBest)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Re-detect button */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800">
        <label className="text-xs text-muted-foreground">Sectors:</label>
        <select
          value={numSectors}
          onChange={(e) => setNumSectors(Number(e.target.value))}
          className="bg-muted border-none rounded px-2 py-0.5 text-xs"
        >
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          onClick={handleAutoDetect}
          disabled={loading}
          className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {loading ? "Re-detecting..." : "Re-detect"}
        </button>
        {data.theoretical_best_ms && (
          <span className="ml-auto text-xs text-muted-foreground">
            Theoretical best: {formatLapTime(data.theoretical_best_ms)}
          </span>
        )}
      </div>
    </div>
  );
}
