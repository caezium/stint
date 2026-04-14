"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSessions, type Session } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = sessions.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.venue.toLowerCase().includes(q) ||
      s.driver.toLowerCase().includes(q) ||
      s.file_name.toLowerCase().includes(q) ||
      (s.vehicle && s.vehicle.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} recorded
          </p>
        </div>
        <Link href="/upload">
          <Button>Upload XRK</Button>
        </Link>
      </div>

      <div className="mb-6">
        <Input
          placeholder="Search by venue, driver, or file name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <svg
            className="animate-spin h-5 w-5 mr-3"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading sessions...
        </div>
      )}

      {error && (
        <div className="text-center py-20">
          <p className="text-destructive mb-2">Failed to load sessions</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">🏎️</div>
          <h2 className="text-lg font-medium mb-2">
            {search
              ? "No sessions match your search"
              : "No sessions yet"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {search
              ? "Try a different search term."
              : "Upload your first XRK file to get started."}
          </p>
          {!search && (
            <Link href="/upload">
              <Button>Upload XRK File</Button>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((session) => (
          <Link key={session.id} href={`/sessions/${session.id}`}>
            <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-base leading-tight">
                    {session.venue || "Unknown Venue"}
                  </h3>
                  <Badge variant="secondary" className="ml-2 shrink-0 text-xs">
                    {session.lap_count} laps
                  </Badge>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Driver</span>
                    <span className="text-foreground">
                      {session.driver || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date</span>
                    <span className="text-foreground">
                      {session.log_date || "—"}
                    </span>
                  </div>
                  {session.best_lap_time_ms != null && session.best_lap_time_ms > 0 && (
                    <div className="flex justify-between">
                      <span>Best Lap</span>
                      <span className="text-green-400 font-mono">
                        {formatLapTime(session.best_lap_time_ms)}
                      </span>
                    </div>
                  )}
                  {session.logger_model && (
                    <div className="flex justify-between">
                      <span>Logger</span>
                      <span className="text-foreground">
                        {session.logger_model}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
