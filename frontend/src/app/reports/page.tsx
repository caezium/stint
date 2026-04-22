"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchSessions,
  renderReport,
  renderReportPdf,
  exportBulk,
  listReportTemplates,
  createReportTemplate,
  deleteReportTemplate,
  downloadBlob,
  type Session,
  type ReportSpec,
  type ReportStat,
  type ReportLapFilter,
  type ReportResponse,
  type ReportSessionResult,
  type ReportTemplate,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Report Builder (Phase 23). Lets the user pick sessions + channels + stats
 * + a lap filter, renders a per-lap aggregate table per session, and exposes
 * PDF export, batch CSV/JSON zip export, and named templates.
 */

const ALL_STATS: ReportStat[] = [
  "min",
  "max",
  "avg",
  "p50",
  "p90",
  "p99",
  "std",
  "count",
];

const LAP_FILTERS: { value: ReportLapFilter; label: string }[] = [
  { value: "all", label: "All laps" },
  { value: "clean", label: "Clean (within 15% of best)" },
  { value: "clean_no_pit", label: "Clean · no pit laps" },
];

const DEFAULT_CHANNELS = [
  "GPS Speed",
  "RPM",
  "Throttle",
  "Brake",
  "Lateral Accel",
];

const DEFAULT_STATS: ReportStat[] = ["min", "max", "avg", "p90"];

function fmtCell(v: number | null | undefined, stat: ReportStat): string {
  if (v == null) return "—";
  if (stat === "count") return String(Math.round(v));
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function ReportsPage() {
  // ----- data / backing state -----
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [channelsText, setChannelsText] = useState(DEFAULT_CHANNELS.join(", "));
  const [stats, setStats] = useState<Set<ReportStat>>(new Set(DEFAULT_STATS));
  const [lapFilter, setLapFilter] = useState<ReportLapFilter>("clean_no_pit");
  const [reportName, setReportName] = useState("Untitled report");

  // ----- response state -----
  const [response, setResponse] = useState<ReportResponse | null>(null);
  const [busy, setBusy] = useState<null | "render" | "pdf" | "zip">(null);
  const [error, setError] = useState<string | null>(null);

  // ----- templates -----
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
    refreshTemplates();
  }, []);

  function refreshTemplates() {
    listReportTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }

  // ----- derived -----
  const filteredSessions = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      `${s.driver} ${s.venue} ${s.log_date} ${s.vehicle} ${s.file_name}`
        .toLowerCase()
        .includes(q),
    );
  }, [sessions, filterText]);

  const channels = useMemo(
    () =>
      channelsText
        .split(/[,\n]/)
        .map((c) => c.trim())
        .filter(Boolean),
    [channelsText],
  );

  const spec: ReportSpec = useMemo(
    () => ({
      name: reportName || "Untitled report",
      channels,
      stats: ALL_STATS.filter((s) => stats.has(s)),
      lap_filter: lapFilter,
      session_ids: Array.from(selected),
    }),
    [reportName, channels, stats, lapFilter, selected],
  );

  const canRun =
    spec.channels.length > 0 &&
    spec.stats.length > 0 &&
    spec.session_ids.length > 0;

  // ----- actions -----
  function toggleSession(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  }

  function toggleStat(s: ReportStat) {
    const n = new Set(stats);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setStats(n);
  }

  async function doRender() {
    if (!canRun) return;
    setBusy("render");
    setError(null);
    try {
      const r = await renderReport(spec);
      setResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to render");
    } finally {
      setBusy(null);
    }
  }

  async function doRenderPdf() {
    if (!canRun) return;
    setBusy("pdf");
    setError(null);
    try {
      const blob = await renderReportPdf(spec);
      downloadBlob(blob, `${(spec.name || "report").replace(/\s+/g, "_")}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setBusy(null);
    }
  }

  async function doBulkZip() {
    if (selected.size === 0) return;
    setBusy("zip");
    setError(null);
    try {
      const blob = await exportBulk(Array.from(selected), ["csv", "json"]);
      downloadBlob(blob, `stint-export-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export ZIP");
    } finally {
      setBusy(null);
    }
  }

  async function doSaveTemplate() {
    if (!saveName.trim()) return;
    try {
      await createReportTemplate(saveName.trim(), spec, "");
      setSaveOpen(false);
      setSaveName("");
      refreshTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save template");
    }
  }

  function loadTemplate(t: ReportTemplate) {
    setReportName(t.name);
    setChannelsText((t.spec.channels || []).join(", "));
    setStats(new Set(t.spec.stats || DEFAULT_STATS));
    setLapFilter(t.spec.lap_filter || "clean_no_pit");
    // Do not wipe selected sessions; template scope is portable across them.
  }

  async function doDeleteTemplate(id: number) {
    if (!confirm("Delete this template?")) return;
    try {
      await deleteReportTemplate(id);
      refreshTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete template");
    }
  }

  // ----- render -----
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Report Builder</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compute per-lap channel aggregates across any set of sessions.
            Save common configurations as templates, export as PDF, or batch
            download CSV/JSON.
          </p>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-3 text-sm text-red-400">
            {error}
          </CardContent>
        </Card>
      )}

      {/* ---------- Top config bar ---------- */}
      <div className="grid lg:grid-cols-[1fr_380px] gap-4">
        {/* Column 1 — session picker */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Sessions</h2>
              <span className="text-xs text-muted-foreground">
                {selected.size} selected
              </span>
            </div>
            <Input
              placeholder="Filter by driver / venue / date…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <div className="max-h-[280px] overflow-y-auto border border-border/50 rounded">
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
                  {filteredSessions.map((s) => (
                    <TableRow
                      key={s.id}
                      className={selected.has(s.id) ? "bg-primary/5" : ""}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggleSession(s.id)}
                        />
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {s.venue || "—"}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate">
                        {s.driver || "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {s.log_date || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {s.lap_count}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {s.best_lap_time_ms
                          ? formatLapTime(s.best_lap_time_ms)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredSessions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                        No sessions match.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Column 2 — channels / stats / filter */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Report name
              </label>
              <Input
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="Untitled report"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Channels (comma-separated)
              </label>
              <textarea
                className="w-full h-20 mt-1 rounded-md bg-background border border-input px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                value={channelsText}
                onChange={(e) => setChannelsText(e.target.value)}
                placeholder="GPS Speed, RPM, Throttle"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Names must match logged channels. {channels.length} parsed.
              </p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Stats
              </label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ALL_STATS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStat(s)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      stats.has(s)
                        ? "bg-primary/20 border-primary text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Lap filter
              </label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {LAP_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setLapFilter(f.value)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      lapFilter === f.value
                        ? "bg-primary/20 border-primary text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={doRender} disabled={!canRun || busy !== null} size="sm">
                {busy === "render" ? "Rendering…" : "Render"}
              </Button>
              <Button
                onClick={doRenderPdf}
                disabled={!canRun || busy !== null}
                size="sm"
                variant="secondary"
              >
                {busy === "pdf" ? "Exporting…" : "Export PDF"}
              </Button>
              <Button
                onClick={doBulkZip}
                disabled={selected.size === 0 || busy !== null}
                size="sm"
                variant="secondary"
              >
                {busy === "zip" ? "Packaging…" : "Download zip"}
              </Button>
              <Button
                onClick={() => {
                  setSaveName(reportName);
                  setSaveOpen(true);
                }}
                disabled={!canRun}
                size="sm"
                variant="secondary"
              >
                Save template
              </Button>
            </div>

            {saveOpen && (
              <div className="mt-2 p-3 rounded-md border border-border/60 bg-muted/30 space-y-2">
                <Input
                  placeholder="Template name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={doSaveTemplate}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSaveOpen(false);
                      setSaveName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Templates ---------- */}
      {templates.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">
                Templates
              </span>
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-1 border border-border/60 rounded-md pl-2 pr-1 py-1"
                >
                  <button
                    onClick={() => loadTemplate(t)}
                    className="text-xs hover:text-primary"
                  >
                    {t.name}
                  </button>
                  <button
                    onClick={() => doDeleteTemplate(t.id)}
                    className="text-xs text-muted-foreground hover:text-red-400 px-1"
                    title="Delete template"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- Report output ---------- */}
      {response && (
        <div className="space-y-4">
          {response.reports.map((r) => (
            <ReportPanel key={r.session_id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportPanel({ report }: { report: ReportSessionResult }) {
  if (report.error) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-sm">
            Session <code className="text-xs">{report.session_id}</code> —{" "}
            <span className="text-red-400">{report.error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  const meta = report.session_meta || {};
  const channels = report.channels || [];
  const stats = (report.stats || []) as ReportStat[];
  const laps = report.laps || [];
  const sw = report.session_wide || {};

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-semibold">
              {meta.venue || "Unknown venue"}
              <span className="text-muted-foreground font-normal">
                {" · "}
                {meta.driver || "—"} · {meta.log_date || "—"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {laps.length} laps · filter: {report.lap_filter}
            </div>
          </div>
          {meta.best_lap_time_ms && (
            <Badge variant="secondary" className="font-mono">
              PB {formatLapTime(meta.best_lap_time_ms)}
            </Badge>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/40">
                <th className="px-2 py-1.5 text-left border-b border-border/60">Lap</th>
                <th className="px-2 py-1.5 text-left border-b border-border/60">Time</th>
                {channels.map((c) => (
                  <th
                    key={c}
                    colSpan={stats.length}
                    className="px-2 py-1.5 text-center border-b border-l border-border/60 font-semibold"
                  >
                    {c}
                  </th>
                ))}
              </tr>
              <tr className="bg-muted/20 text-muted-foreground">
                <th className="px-2 py-1 text-left border-b border-border/60"></th>
                <th className="px-2 py-1 text-left border-b border-border/60"></th>
                {channels.map((c) =>
                  stats.map((s, idx) => (
                    <th
                      key={`${c}-${s}`}
                      className={`px-2 py-1 text-right border-b border-border/60 ${
                        idx === 0 ? "border-l" : ""
                      }`}
                    >
                      {s}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {laps.map((l) => (
                <tr
                  key={l.num}
                  className={l.is_pit_lap ? "text-muted-foreground" : ""}
                >
                  <td className="px-2 py-1 font-mono">
                    L{l.num}
                    {l.is_pit_lap && <span className="ml-1 text-amber-400">·pit</span>}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {l.duration_ms > 0 ? formatLapTime(l.duration_ms) : "—"}
                  </td>
                  {channels.map((c) =>
                    stats.map((s, idx) => (
                      <td
                        key={`${c}-${s}`}
                        className={`px-2 py-1 text-right font-mono ${
                          idx === 0 ? "border-l border-border/40" : ""
                        }`}
                      >
                        {fmtCell(l.cells?.[c]?.[s] ?? null, s)}
                      </td>
                    )),
                  )}
                </tr>
              ))}
              <tr className="bg-muted/20 font-medium">
                <td className="px-2 py-1 italic">Session</td>
                <td className="px-2 py-1">—</td>
                {channels.map((c) =>
                  stats.map((s, idx) => (
                    <td
                      key={`${c}-${s}`}
                      className={`px-2 py-1 text-right font-mono ${
                        idx === 0 ? "border-l border-border/40" : ""
                      }`}
                    >
                      {fmtCell(sw?.[c]?.[s] ?? null, s)}
                    </td>
                  )),
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
