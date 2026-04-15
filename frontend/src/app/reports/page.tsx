"use client";

import { useEffect, useState } from "react";
import {
  fetchSessions,
  fetchMultiSessionReport,
  type Session,
  type MultiSessionReportRow,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ReportsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<MultiSessionReportRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  function toggle(id: string) {
    const nxt = new Set(selected);
    if (nxt.has(id)) nxt.delete(id);
    else nxt.add(id);
    setSelected(nxt);
  }

  async function run() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const r = await fetchMultiSessionReport(Array.from(selected));
      setRows(r.sessions);
    } finally {
      setBusy(false);
    }
  }

  const maxBest = Math.max(1, ...rows.map((r) => r.best_lap_ms ?? 0));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
      <p className="text-sm text-muted-foreground">
        Select sessions for a multi-session comparison.
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Laps</TableHead>
                <TableHead>Best</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                  </TableCell>
                  <TableCell>{s.venue || "—"}</TableCell>
                  <TableCell>{s.driver || "—"}</TableCell>
                  <TableCell>{s.log_date || "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{s.lap_count}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {s.best_lap_time_ms ? formatLapTime(s.best_lap_time_ms) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div>
        <Button onClick={run} disabled={busy || selected.size === 0}>
          {busy ? "Running..." : `Generate report (${selected.size})`}
        </Button>
      </div>

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-semibold">Report</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead>Avg</TableHead>
                  <TableHead>Median</TableHead>
                  <TableHead>Stddev</TableHead>
                  <TableHead>Theo. best</TableHead>
                  <TableHead>Laps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.session_id}>
                    <TableCell>{r.venue || r.file_name}</TableCell>
                    <TableCell className="font-mono">
                      {r.best_lap_ms ? formatLapTime(r.best_lap_ms) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.avg_lap_ms ? formatLapTime(r.avg_lap_ms) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.median_lap_ms ? formatLapTime(r.median_lap_ms) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.stddev_lap_ms != null ? `${(r.stddev_lap_ms / 1000).toFixed(2)}s` : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.theoretical_best_ms ? formatLapTime(r.theoretical_best_ms) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{r.counted_laps}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <BestLapChart rows={rows} maxBest={maxBest} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BestLapChart({
  rows,
  maxBest,
}: {
  rows: MultiSessionReportRow[];
  maxBest: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0 || maxBest <= 0) return null;

  const padL = 160;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const barH = 22;
  const gap = 8;
  const innerW = 520;
  const width = padL + innerW + padR;
  const height = padT + (barH + gap) * rows.length + padB;
  const minBest = Math.min(
    ...rows.map((r) => r.best_lap_ms ?? Number.POSITIVE_INFINITY)
  );

  return (
    <div>
      <h3 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">
        Best laps
      </h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="bg-[#0c0c0c] rounded"
        style={{ maxWidth: width }}
      >
        {/* X axis gridlines + labels (3 ticks) */}
        {[0, 0.5, 1].map((frac, i) => {
          const x = padL + innerW * frac;
          const tickMs = maxBest * frac;
          return (
            <g key={`t-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={padT}
                y2={height - padB}
                stroke="#262626"
                strokeDasharray="2 3"
              />
              <text
                x={x}
                y={height - padB + 14}
                fontSize={10}
                fill="#888"
                textAnchor="middle"
              >
                {tickMs > 0 ? formatLapTime(tickMs) : "0"}
              </text>
            </g>
          );
        })}

        {rows.map((r, i) => {
          const y = padT + i * (barH + gap);
          const best = r.best_lap_ms ?? 0;
          const w = maxBest > 0 ? (best / maxBest) * innerW : 0;
          const isMin = best === minBest && best > 0;
          const color = isMin ? "#22c55e" : "#ef4444";
          return (
            <g
              key={r.session_id}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              <text
                x={padL - 8}
                y={y + barH * 0.7}
                fontSize={11}
                fill="#d4d4d4"
                textAnchor="end"
              >
                {(r.venue || r.file_name).slice(0, 22)}
              </text>
              <rect
                x={padL}
                y={y}
                width={innerW}
                height={barH}
                fill="#1a1a1a"
                rx={3}
              />
              <rect
                x={padL}
                y={y}
                width={w}
                height={barH}
                fill={color}
                opacity={hover === i ? 1 : 0.85}
                rx={3}
              />
              <text
                x={padL + w + 6}
                y={y + barH * 0.7}
                fontSize={11}
                fill="#d4d4d4"
              >
                {best ? formatLapTime(best) : "—"}
              </text>
              {hover === i && (
                <g>
                  <rect
                    x={padL + 4}
                    y={y + 2}
                    width={160}
                    height={barH - 4}
                    fill="#000"
                    opacity={0.75}
                    rx={2}
                  />
                  <text
                    x={padL + 10}
                    y={y + barH * 0.7}
                    fontSize={10}
                    fill="#fff"
                  >
                    avg {r.avg_lap_ms ? formatLapTime(r.avg_lap_ms) : "—"} · laps {r.counted_laps}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* X axis label */}
        <text
          x={padL + innerW / 2}
          y={height - 6}
          fontSize={10}
          fill="#888"
          textAnchor="middle"
        >
          Best lap time
        </text>
      </svg>
    </div>
  );
}
