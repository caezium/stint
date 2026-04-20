"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchSharedSession, type Session, type Lap } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SharedSessionPage() {
  const params = useParams();
  const token = String(params.token);

  const [data, setData] = useState<{ session: Session; laps: Lap[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSharedSession(token)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) =>
        !cancelled && setError(e instanceof Error ? e.message : "Failed to load")
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-2">
        <h1 className="text-xl font-bold">Link unavailable</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const { session, laps } = data;
  const racing = laps.filter((l) => l.num > 0 && l.duration_ms > 0 && !l.is_pit_lap);
  const best = racing.length
    ? Math.min(...racing.map((l) => l.duration_ms))
    : 0;
  const worst = racing.length
    ? Math.max(...racing.map((l) => l.duration_ms))
    : 0;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          Shared session · read-only
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-1">
          {session.venue || "Unknown Venue"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {session.driver || "—"}
          {session.vehicle && ` · ${session.vehicle}`}
          {session.log_date && ` · ${session.log_date}`}
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Metric label="Laps" value={String(session.lap_count)} />
            <Metric
              label="Best lap"
              value={best ? formatLapTime(best) : "—"}
              color="text-green-400 font-mono"
            />
            <Metric
              label="Total duration"
              value={
                session.total_duration_ms
                  ? `${Math.round(session.total_duration_ms / 60000)}m`
                  : "—"
              }
            />
            <Metric label="Logger" value={session.logger_model || "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border/60">
            <h2 className="font-semibold text-sm">Lap times</h2>
          </div>
          <div className="divide-y divide-border/40">
            {laps.map((l) => (
              <div
                key={l.num}
                className="px-5 py-2 flex items-center justify-between text-sm"
              >
                <div>
                  L{l.num}
                  {l.is_pit_lap ? (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      pit
                    </Badge>
                  ) : null}
                </div>
                <div
                  className={`font-mono ${
                    !l.is_pit_lap && l.duration_ms === best
                      ? "text-green-400"
                      : !l.is_pit_lap && l.duration_ms === worst
                        ? "text-amber-400"
                        : ""
                  }`}
                >
                  {l.duration_ms > 0 ? formatLapTime(l.duration_ms) : "—"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center pt-2">
        Powered by Stint · a read-only coach share
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={color ?? "font-medium"}>{value}</div>
    </div>
  );
}
