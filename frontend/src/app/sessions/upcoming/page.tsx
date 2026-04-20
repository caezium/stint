"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  fetchSessions,
  type Session,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function PreSessionInner() {
  const params = useSearchParams();
  const venue = (params.get("venue") || "").trim();
  const driver = (params.get("driver") || "").trim();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions({ includeTags: true })
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const atVenue = useMemo(() => {
    if (!venue) return sessions;
    return sessions.filter(
      (s) => (s.venue || "").toLowerCase() === venue.toLowerCase()
    );
  }, [sessions, venue]);

  const byDriver = useMemo(() => {
    if (!driver) return atVenue;
    return atVenue.filter(
      (s) => (s.driver || "").toLowerCase() === driver.toLowerCase()
    );
  }, [atVenue, driver]);

  const pb = useMemo(() => {
    let best: Session | null = null;
    for (const s of byDriver) {
      if (s.best_lap_time_ms && s.best_lap_time_ms > 0) {
        if (!best || (best.best_lap_time_ms ?? Infinity) > s.best_lap_time_ms) {
          best = s;
        }
      }
    }
    return best;
  }, [byDriver]);

  const recent = useMemo(
    () =>
      [...byDriver]
        .sort((a, b) => (b.log_date || "").localeCompare(a.log_date || ""))
        .slice(0, 5),
    [byDriver]
  );

  const allVenues = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.venue).filter(Boolean))).sort(),
    [sessions]
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pre-session brief</h1>
        <p className="text-muted-foreground text-sm mt-1">
          What to focus on before your next session. Pick a venue to see
          history + open coaching items.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-2 text-sm">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Venue
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allVenues.length === 0 && loading && (
              <span className="text-muted-foreground text-xs">Loading…</span>
            )}
            {allVenues.map((v) => (
              <Link
                key={v}
                href={`/sessions/upcoming?venue=${encodeURIComponent(v)}${driver ? `&driver=${encodeURIComponent(driver)}` : ""}`}
                className={`px-2 py-1 text-xs rounded-full border ${
                  v.toLowerCase() === venue.toLowerCase()
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 hover:border-border"
                }`}
              >
                {v}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {venue && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">{venue}</h2>
            {pb ? (
              <div className="text-sm">
                <span className="text-muted-foreground">Personal best: </span>
                <span className="font-mono text-green-400">
                  {formatLapTime(pb.best_lap_time_ms!)}
                </span>
                <span className="text-muted-foreground ml-2">
                  ({pb.log_date})
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No prior best-lap data for this venue{driver ? ` with ${driver}` : ""}.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {recent.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base">Recent sessions</h2>
              <span className="text-xs text-muted-foreground">
                {recent.length} most recent
              </span>
            </div>
            <div className="space-y-1.5">
              {recent.map((s) => (
                <Link
                  key={s.id}
                  href={`/sessions/${s.id}`}
                  className="flex items-center justify-between px-3 py-2 rounded-md border border-border/40 hover:border-border text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {s.log_date || "—"}
                      <span className="text-xs text-muted-foreground ml-2">
                        {s.driver} · {s.lap_count} laps
                      </span>
                    </div>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {(s.tags ?? []).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  {s.best_lap_time_ms && s.best_lap_time_ms > 0 && (
                    <span className="font-mono text-xs text-green-400">
                      {formatLapTime(s.best_lap_time_ms)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {venue && recent.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No sessions at {venue} yet. Upload one to seed the pre-session brief.
          </CardContent>
        </Card>
      )}

      <Link href="/upload">
        <Button>Upload next session</Button>
      </Link>
    </div>
  );
}

export default function PreSessionPage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}
    >
      <PreSessionInner />
    </Suspense>
  );
}
