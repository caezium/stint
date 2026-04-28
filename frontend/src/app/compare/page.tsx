"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  fetchSessions,
  fetchSession,
  fetchCrossSessionDeltaT,
  fetchComparePerCorner,
  type Session,
  type SessionDetail,
  type DeltaTData,
  type ComparePerCornerData,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type Pick = { sessionId: string; lap: number } | null;

function serializePick(p: Pick): string | null {
  return p ? `${p.sessionId}:${p.lap}` : null;
}
function parsePick(s: string | null | undefined): Pick {
  if (!s) return null;
  const [sid, lapStr] = s.split(":");
  const lap = Number(lapStr);
  if (!sid || !Number.isFinite(lap)) return null;
  return { sessionId: sid, lap };
}

function ComparePageInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [a, setA] = useState<Pick>(parsePick(params.get("a")));
  const [b, setB] = useState<Pick>(parsePick(params.get("b")));

  const [detailA, setDetailA] = useState<SessionDetail | null>(null);
  const [detailB, setDetailB] = useState<SessionDetail | null>(null);

  const [delta, setDelta] = useState<DeltaTData | null>(null);
  const [perCorner, setPerCorner] = useState<ComparePerCornerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    const av = serializePick(a);
    const bv = serializePick(b);
    if (av) q.set("a", av);
    if (bv) q.set("b", bv);
    const s = q.toString();
    router.replace(s ? `/compare?${s}` : "/compare", { scroll: false });
  }, [a, b, router]);

  useEffect(() => {
    setDetailA(null);
    if (!a) return;
    fetchSession(a.sessionId).then(setDetailA).catch(() => setDetailA(null));
  }, [a?.sessionId]);

  useEffect(() => {
    setDetailB(null);
    if (!b) return;
    fetchSession(b.sessionId).then(setDetailB).catch(() => setDetailB(null));
  }, [b?.sessionId]);

  useEffect(() => {
    setDelta(null);
    setPerCorner(null);
    setError(null);
    if (!a || !b || a.lap <= 0 || b.lap <= 0) return;
    setLoading(true);
    fetchCrossSessionDeltaT(
      { session_id: a.sessionId, lap: a.lap },
      { session_id: b.sessionId, lap: b.lap }
    )
      .then(setDelta)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to compute delta")
      )
      .finally(() => setLoading(false));
    // Per-corner is best-effort — silently empty if neither session has
    // corners detected yet.
    fetchComparePerCorner(
      { session_id: a.sessionId, lap: a.lap },
      { session_id: b.sessionId, lap: b.lap },
    )
      .then((d) => setPerCorner(d.corners.length > 0 ? d : null))
      .catch(() => setPerCorner(null));
  }, [a?.sessionId, a?.lap, b?.sessionId, b?.lap]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((s) => ({
        value: s.id,
        label: `${s.venue || "?"} · ${s.driver || "?"} · ${s.log_date || "?"}`,
      })),
    [sessions]
  );
  const lapOptionsA = useMemo(
    () =>
      (detailA?.laps ?? [])
        .filter((l) => l.num > 0 && l.duration_ms > 0)
        .map((l) => ({
          value: l.num,
          label: `L${l.num} · ${formatLapTime(l.duration_ms)}`,
        })),
    [detailA]
  );
  const lapOptionsB = useMemo(
    () =>
      (detailB?.laps ?? [])
        .filter((l) => l.num > 0 && l.duration_ms > 0)
        .map((l) => ({
          value: l.num,
          label: `L${l.num} · ${formatLapTime(l.duration_ms)}`,
        })),
    [detailB]
  );

  const lapA = a && detailA ? detailA.laps.find((l) => l.num === a.lap) : null;
  const lapB = b && detailB ? detailB.laps.find((l) => l.num === b.lap) : null;

  const chartData = useMemo(() => {
    if (!delta) return [];
    return delta.distance_m.map((d, i) => ({
      distance: d,
      delta: delta.delta_seconds[i],
    }));
  }, [delta]);

  const finalDelta =
    delta && delta.delta_seconds.length > 0
      ? delta.delta_seconds[delta.delta_seconds.length - 1]
      : null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compare laps</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Side-by-side view of any two laps across sessions.
          </p>
        </div>
        <Link href="/sessions">
          <Button variant="secondary" size="sm">
            Back to sessions
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LapPicker
          label="Lap A (reference)"
          pick={a}
          setPick={setA}
          sessionOptions={sessionOptions}
          lapOptions={lapOptionsA}
          detail={detailA}
          lap={lapA ?? null}
        />
        <LapPicker
          label="Lap B (compare)"
          pick={b}
          setPick={setB}
          sessionOptions={sessionOptions}
          lapOptions={lapOptionsB}
          detail={detailB}
          lap={lapB ?? null}
        />
      </div>

      {(!a || !b || a.lap <= 0 || b.lap <= 0) && (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground text-center">
            Pick a session and lap on each side to see the delta trace.
          </CardContent>
        </Card>
      )}

      {a && b && a.lap > 0 && b.lap > 0 && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base">Delta-T (B − A)</h2>
              {finalDelta != null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Final:</span>{" "}
                  <span
                    className={`font-mono ${finalDelta < 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {finalDelta > 0 ? "+" : ""}
                    {finalDelta.toFixed(3)}s
                  </span>
                </div>
              )}
            </div>

            {loading && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Computing delta…
              </div>
            )}
            {error && (
              <div className="text-sm text-destructive py-4 text-center">{error}</div>
            )}
            {delta && chartData.length > 0 && (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis
                      dataKey="distance"
                      tick={{ fill: "#888", fontSize: 11 }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(1)}km`}
                    />
                    <YAxis
                      tick={{ fill: "#888", fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        v > 0 ? `+${v.toFixed(2)}s` : `${v.toFixed(2)}s`
                      }
                    />
                    <Tooltip
                      formatter={(value) => {
                        const v = Number(value ?? 0);
                        return [
                          `${v > 0 ? "+" : ""}${v.toFixed(3)}s`,
                          "Delta",
                        ];
                      }}
                      labelFormatter={(label) => {
                        const v = Number(label ?? 0);
                        return `${(v / 1000).toFixed(2)} km`;
                      }}
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: 4,
                      }}
                    />
                    <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="delta"
                      stroke="#eab308"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {lapA && lapB && (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold text-base mb-3">Lap summary</h2>
            <div className="grid grid-cols-3 gap-y-1.5 text-sm">
              <div />
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                A
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                B
              </div>
              <div className="text-muted-foreground">Duration</div>
              <div className="font-mono">{formatLapTime(lapA.duration_ms)}</div>
              <div className="font-mono">{formatLapTime(lapB.duration_ms)}</div>
              <div className="text-muted-foreground">Delta (B − A)</div>
              <div
                className={`col-span-2 font-mono ${
                  lapB.duration_ms < lapA.duration_ms
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {lapB.duration_ms > lapA.duration_ms ? "+" : ""}
                {((lapB.duration_ms - lapA.duration_ms) / 1000).toFixed(3)}s
              </div>
              {lapA.split_times && lapA.split_times.length > 0 && lapB.split_times && (
                <>
                  <div className="col-span-3 mt-3 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Split times
                  </div>
                  {lapA.split_times.map((tA, idx) => {
                    const tB = lapB.split_times?.[idx] ?? null;
                    return (
                      <SectorRow
                        key={idx}
                        label={`S${idx + 1}`}
                        a={tA ?? null}
                        b={tB}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {perCorner && perCorner.corners.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold text-base mb-1">
              Per-corner comparison
            </h2>
            <p className="text-[11px] text-muted-foreground mb-3">
              Corner-by-corner timing. Negative delta = B is faster through the
              corner. Big positive numbers are where most of the lap-time gap
              lives. Bands derived from{" "}
              <span className="font-mono">
                {perCorner.source_session === a?.sessionId ? "A" : "B"}
              </span>
              ’s detected corners.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">
                      Corner
                    </th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">
                      Dir
                    </th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">
                      A min
                    </th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">
                      B min
                    </th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">
                      A time
                    </th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">
                      B time
                    </th>
                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">
                      Δ (B − A)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perCorner.corners.map((row) => {
                    const tone =
                      row.delta_ms == null
                        ? "text-muted-foreground"
                        : row.delta_ms <= 0
                          ? "text-emerald-400"
                          : row.delta_ms < 50
                            ? "text-amber-400"
                            : "text-red-400";
                    return (
                      <tr
                        key={row.corner_num}
                        className="border-t border-border/30"
                      >
                        <td className="px-2 py-1.5 font-medium">
                          {row.label || `C${row.corner_num}`}
                          {row.label ? (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              (C{row.corner_num})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              row.direction === "right"
                                ? "text-sky-400"
                                : row.direction === "left"
                                  ? "text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {row.direction || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {row.ref?.min_speed != null
                            ? `${row.ref.min_speed.toFixed(1)}`
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {row.compare?.min_speed != null
                            ? `${row.compare.min_speed.toFixed(1)}`
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {row.ref?.corner_ms != null
                            ? `${(row.ref.corner_ms / 1000).toFixed(3)}s`
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {row.compare?.corner_ms != null
                            ? `${(row.compare.corner_ms / 1000).toFixed(3)}s`
                            : "—"}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono ${tone}`}>
                          {row.delta_ms != null
                            ? `${row.delta_ms > 0 ? "+" : ""}${(row.delta_ms / 1000).toFixed(3)}s`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SectorRow({
  label,
  a,
  b,
}: {
  label: string;
  a: number | null;
  b: number | null;
}) {
  const delta =
    a != null && b != null ? b - a : null;
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono">{a != null ? `${(a / 1000).toFixed(3)}s` : "—"}</div>
      <div className="font-mono">
        {b != null ? `${(b / 1000).toFixed(3)}s` : "—"}
        {delta != null && (
          <span
            className={`ml-2 text-xs ${delta < 0 ? "text-green-400" : "text-red-400"}`}
          >
            ({delta > 0 ? "+" : ""}
            {(delta / 1000).toFixed(3)})
          </span>
        )}
      </div>
    </>
  );
}

interface LapPickerProps {
  label: string;
  pick: Pick;
  setPick: (p: Pick) => void;
  sessionOptions: { value: string; label: string }[];
  lapOptions: { value: number; label: string }[];
  detail: SessionDetail | null;
  lap: { duration_ms: number } | null;
}

function LapPicker({
  label,
  pick,
  setPick,
  sessionOptions,
  lapOptions,
  detail,
  lap,
}: LapPickerProps) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <Select<string>
          value={pick?.sessionId ?? ""}
          onValueChange={(v) =>
            setPick(v ? { sessionId: v, lap: pick?.lap ?? 0 } : null)
          }
          options={[{ value: "", label: "Pick a session…" }, ...sessionOptions]}
          triggerClassName="w-full"
        />
        {detail && (
          <Select<number>
            value={pick?.lap ?? -1}
            onValueChange={(v) => {
              if (!pick) return;
              setPick({ ...pick, lap: v });
            }}
            options={[{ value: -1, label: "Pick a lap…" }, ...lapOptions]}
            triggerClassName="w-full"
          />
        )}
        {detail && (
          <div className="text-xs text-muted-foreground">
            {detail.venue || "Unknown"} · {detail.driver || "—"} ·{" "}
            {detail.log_date || "—"}
          </div>
        )}
        {lap && (
          <div className="text-sm">
            <span className="text-muted-foreground">Lap time: </span>
            <span className="font-mono">{formatLapTime(lap.duration_ms)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}
    >
      <ComparePageInner />
    </Suspense>
  );
}
