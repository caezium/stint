"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchDriverSummary,
  type DriverSummary,
  type DriverFingerprintPoint,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TAG_STYLE: Record<string, string> = {
  "personal-best":
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  clean: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  inconsistent: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "mechanical-concerns": "bg-red-500/15 text-red-300 border-red-500/30",
};

const TAG_LABEL: Record<string, string> = {
  "personal-best": "PB",
  clean: "Clean",
  inconsistent: "Inconsistent",
  "mechanical-concerns": "Mechanical",
};

export default function DriverDashboardPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [data, setData] = useState<DriverSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchDriverSummary(name)
      .then((d) => {
        if (!d) setError(`No data for driver '${name}'`);
        else setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10 text-muted-foreground">
        Loading driver…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10 text-center">
        <p className="text-destructive mb-2">{error ?? "Driver not found"}</p>
        <Link href="/sessions" className="mt-4 inline-block">
          <Button variant="secondary">Back to Sessions</Button>
        </Link>
      </div>
    );
  }

  const { stats, tag_counts, pb_per_venue, fingerprint_series, sessions } = data;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      <Link
        href="/sessions"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-block"
      >
        &larr; Back to Sessions
      </Link>

      {/* Header strip */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-5 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-lg font-bold text-primary-foreground">
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
            <div className="text-xs text-muted-foreground mt-0.5">
              Driver analytics · last session{" "}
              {stats.last_session_date || "—"}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-baseline gap-6">
          <HeaderStat label="Sessions" value={String(stats.session_count)} />
          <HeaderStat label="Venues" value={String(stats.venue_count)} />
          <HeaderStat label="Laps" value={String(stats.total_laps)} />
          <HeaderStat
            label="Personal best"
            value={stats.overall_pb_ms ? formatLapTime(stats.overall_pb_ms) : "—"}
            sub={stats.overall_pb_venue ?? undefined}
            accent
          />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TagDistributionCard counts={tag_counts} total={stats.session_count} />
        <PBVenuesCard venues={pb_per_venue} />
        <FingerprintTrendsCard series={fingerprint_series} />
      </div>

      {/* Progression by venue */}
      <ProgressionByVenueCard sessions={sessions} />

      {/* Session list */}
      <RecentSessionsCard sessions={sessions} />
    </div>
  );
}

function HeaderStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div
        className={`font-mono tabular-nums mt-0.5 ${
          accent ? "text-2xl text-emerald-300" : "text-xl"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag distribution
// ---------------------------------------------------------------------------
function TagDistributionCard({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total: number;
}) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium mb-3">Tags across sessions</h3>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            No tags yet — upload a session to generate tags.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(([tag, count]) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={tag} className="space-y-0.5">
                  <div className="flex items-center justify-between text-xs">
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 ${TAG_STYLE[tag] ?? ""}`}
                    >
                      {TAG_LABEL[tag] ?? tag}
                    </Badge>
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {count} / {total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-muted/40 overflow-hidden">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PB per venue
// ---------------------------------------------------------------------------
function PBVenuesCard({
  venues,
}: {
  venues: DriverSummary["pb_per_venue"];
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium mb-3">Personal bests by venue</h3>
        {venues.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            No lap times recorded yet.
          </div>
        ) : (
          <div className="space-y-1">
            {venues.slice(0, 8).map((v) => (
              <Link
                key={v.venue + v.session_id}
                href={`/sessions/${v.session_id}`}
                className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/60 transition-colors text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-foreground truncate">{v.venue}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {v.session_count} session{v.session_count === 1 ? "" : "s"}
                    {v.log_date && ` · ${v.log_date}`}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-emerald-300">
                  {formatLapTime(v.best_lap_ms)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fingerprint trends — 4 mini sparklines
// ---------------------------------------------------------------------------
function FingerprintTrendsCard({
  series,
}: {
  series: DriverFingerprintPoint[];
}) {
  const metrics: Array<{
    key: keyof DriverFingerprintPoint;
    label: string;
    higherIsBetter: boolean;
  }> = [
    { key: "throttle_smoothness", label: "Throttle smoothness", higherIsBetter: true },
    { key: "steering_smoothness", label: "Steering smoothness", higherIsBetter: true },
    { key: "braking_aggressiveness", label: "Brake aggressiveness", higherIsBetter: false },
    { key: "max_brake", label: "Max brake", higherIsBetter: false },
  ];
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-medium mb-3">Fingerprint over time</h3>
        <div className="space-y-3">
          {metrics.map(({ key, label, higherIsBetter }) => {
            const values = series
              .map((p) => (p[key] as number | null))
              .filter((v): v is number => v != null);
            const latest = values[values.length - 1];
            const first = values[0];
            let trend: "up" | "down" | "flat" = "flat";
            if (values.length >= 2) {
              const delta = latest - first;
              const mag = Math.abs(delta);
              const pct = first !== 0 ? mag / Math.abs(first) : 0;
              if (pct > 0.05) trend = delta > 0 ? "up" : "down";
            }
            const good = higherIsBetter ? trend === "up" : trend === "down";
            const bad = higherIsBetter ? trend === "down" : trend === "up";
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-foreground">
                      {latest != null ? latest.toFixed(3) : "—"}
                    </span>
                    {values.length >= 2 && (
                      <span
                        className={`text-[10px] ${
                          good
                            ? "text-emerald-300"
                            : bad
                              ? "text-red-300"
                              : "text-muted-foreground"
                        }`}
                      >
                        {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"}
                      </span>
                    )}
                  </div>
                </div>
                <Sparkline values={values} good={good} bad={bad} />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Sparkline({
  values,
  good,
  bad,
}: {
  values: number[];
  good?: boolean;
  bad?: boolean;
}) {
  if (values.length < 2) {
    return <div className="h-4 text-[9px] text-muted-foreground/60">— not enough data</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 160;
  const h = 20;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = good
    ? "text-emerald-400"
    : bad
      ? "text-red-400"
      : "text-muted-foreground/60";
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-1 block overflow-visible"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        className={stroke}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Lap-time progression by venue
// ---------------------------------------------------------------------------
function ProgressionByVenueCard({
  sessions,
}: {
  sessions: DriverSummary["sessions"];
}) {
  // Group by venue, reverse chronological → oldest first
  const byVenue = useMemo(() => {
    const acc = new Map<string, { log_date: string | null; best_ms: number }[]>();
    for (const s of [...sessions].reverse()) {
      if (!s.best_lap_time_ms || s.best_lap_time_ms <= 0) continue;
      const v = s.venue ?? "(unknown)";
      if (!acc.has(v)) acc.set(v, []);
      acc.get(v)!.push({ log_date: s.log_date, best_ms: s.best_lap_time_ms });
    }
    return acc;
  }, [sessions]);

  if (byVenue.size === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Best-lap progression</h3>
          <span className="text-[10px] text-muted-foreground">
            one line per venue, left = earliest
          </span>
        </div>
        <div className="space-y-4">
          {Array.from(byVenue.entries()).map(([venue, points]) => {
            const values = points.map((p) => p.best_ms);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1;
            const w = 600;
            const h = 36;
            const step = points.length > 1 ? w / (points.length - 1) : 0;
            const poly = points
              .map((p, i) => {
                const x = i * step;
                const y = h - ((p.best_ms - min) / range) * h;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(" ");
            const improving = values.length >= 2 && values[values.length - 1] < values[0];
            const improvementPct =
              values.length >= 2
                ? ((values[0] - values[values.length - 1]) / values[0]) * 100
                : 0;
            return (
              <div key={venue} className="grid grid-cols-[1fr_auto_3fr_auto] items-center gap-3">
                <div className="text-xs truncate" title={venue}>
                  <div className="text-foreground">{venue}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {points.length} session{points.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="font-mono tabular-nums text-xs text-muted-foreground text-right min-w-[64px]">
                  {formatLapTime(min)}
                </div>
                <svg
                  viewBox={`0 0 ${w} ${h}`}
                  className="w-full h-9"
                  preserveAspectRatio="none"
                >
                  <polyline
                    points={poly}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className={
                      improving ? "text-emerald-400" : "text-amber-400"
                    }
                  />
                  {points.map((p, i) => {
                    const x = i * step;
                    const y = h - ((p.best_ms - min) / range) * h;
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r={2}
                        className={improving ? "fill-emerald-400" : "fill-amber-400"}
                      >
                        <title>
                          {p.log_date}: {formatLapTime(p.best_ms)}
                        </title>
                      </circle>
                    );
                  })}
                </svg>
                <div
                  className={`font-mono tabular-nums text-xs text-right min-w-[60px] ${
                    improving ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {values.length >= 2
                    ? `${improving ? "−" : "+"}${Math.abs(improvementPct).toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent sessions list
// ---------------------------------------------------------------------------
function RecentSessionsCard({
  sessions,
}: {
  sessions: DriverSummary["sessions"];
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium">Sessions</h3>
          <span className="text-[10px] text-muted-foreground">
            {sessions.length} total
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {sessions.slice(0, 30).map((s) => (
            <Link
              key={s.id}
              href={`/sessions/${s.id}`}
              className="grid grid-cols-[2fr_1fr_1fr_auto_auto] gap-3 items-center px-5 py-2 hover:bg-muted/40 transition-colors text-xs"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate">{s.venue || "Session"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {s.log_date}
                  {s.log_time && ` · ${s.log_time}`}
                </div>
              </div>
              <div className="text-muted-foreground">{s.vehicle || "—"}</div>
              <div className="text-muted-foreground">
                {s.lap_count} {s.lap_count === 1 ? "lap" : "laps"}
              </div>
              <div className="flex flex-wrap gap-1">
                {s.tags.map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className={`text-[9px] h-4 ${TAG_STYLE[t] ?? ""}`}
                  >
                    {TAG_LABEL[t] ?? t}
                  </Badge>
                ))}
              </div>
              <div className="font-mono tabular-nums text-emerald-300 text-right min-w-[72px]">
                {s.best_lap_time_ms ? formatLapTime(s.best_lap_time_ms) : "—"}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
