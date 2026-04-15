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
                    <TableCell className="font-mono">{r.counted_laps}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Simple SVG bar chart of best laps */}
            <div>
              <h3 className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Best laps</h3>
              <div className="space-y-1">
                {rows.map((r) => {
                  const best = r.best_lap_ms ?? 0;
                  const pct = (best / maxBest) * 100;
                  return (
                    <div key={r.session_id} className="flex items-center gap-2 text-xs">
                      <div className="w-40 truncate">{r.venue || r.file_name}</div>
                      <div className="flex-1 bg-muted rounded h-4 relative">
                        <div
                          className="absolute inset-y-0 left-0 bg-red-500 rounded"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-20 text-right font-mono">
                        {best ? formatLapTime(best) : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
