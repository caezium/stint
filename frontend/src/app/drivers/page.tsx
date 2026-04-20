"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDrivers, type Driver } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DriversIndexPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDrivers()
      .then((d) => {
        setDrivers(d);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load drivers")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
          <p className="text-sm text-muted-foreground">
            Per-driver analytics: session history, personal bests, fingerprint trends.
          </p>
        </div>
        <Link href="/upload">
          <Button size="sm">Upload XRK</Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm py-10 text-center">Loading…</div>
      ) : error ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-destructive text-sm">Failed to load drivers</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="text-5xl">👤</div>
          <h2 className="text-lg font-medium">No drivers yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Upload an XRK and Stint will auto-create a driver profile from the logger metadata.
          </p>
          <Link href="/upload">
            <Button>Upload your first session</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {drivers.map((d) => (
            <Link key={d.id} href={`/drivers/${encodeURIComponent(d.name)}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                    {d.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {d.session_count != null && d.session_count > 0 ? (
                        <span>
                          {d.session_count} session{d.session_count === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span>No sessions</span>
                      )}
                      {d.best_lap_time_ms != null && d.best_lap_time_ms > 0 && (
                        <span className="text-green-400 font-mono">
                          PB {formatLapTime(d.best_lap_time_ms)}
                        </span>
                      )}
                    </div>
                    {d.last_session_date && (
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        Last: {d.last_session_date}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
