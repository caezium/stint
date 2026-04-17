"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDrivers, type Driver } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

export default function DriversIndexPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDrivers()
      .then(setDrivers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
      <p className="text-sm text-muted-foreground">
        Per-driver analytics: session history, personal bests, fingerprint trends.
      </p>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : drivers.length === 0 ? (
        <div className="text-muted-foreground text-sm py-10 text-center">
          No drivers yet. Upload a session to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {drivers.map((d) => (
            <Link key={d.id} href={`/drivers/${encodeURIComponent(d.name)}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-sm font-bold text-primary-foreground">
                    {d.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground">
                      View analytics →
                    </div>
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
