"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchSessions,
  fetchDrivers,
  fetchVehicles,
  fetchTracks,
  fetchSmartCollections,
  createSmartCollection,
  deleteSmartCollection,
  fetchSmartCollectionSessions,
  type Session,
  type Driver,
  type Vehicle,
  type Track,
  type SmartCollection,
  type SmartCollectionQuery,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AnomalyBadge } from "@/components/anomaly-badge";
import { SessionTagBadges, TAG_LABEL, TAG_STYLE } from "@/components/session-tag-badges";
import { Select } from "@/components/ui/select";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState("");
  const [driverFilter, setDriverFilter] = useState<number | "">("");
  const [vehicleFilter, setVehicleFilter] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<number | null>(null);
  const [collectionSessions, setCollectionSessions] = useState<Session[] | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDriver, setSaveDriver] = useState<number | "">("");
  const [saveVehicle, setSaveVehicle] = useState<number | "">("");
  const [saveTrack, setSaveTrack] = useState<number | "">("");
  const [saveDateFrom, setSaveDateFrom] = useState("");
  const [saveDateTo, setSaveDateTo] = useState("");
  const [saveMinLaps, setSaveMinLaps] = useState<string>("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  function refreshCollections() {
    fetchSmartCollections().then(setCollections).catch(() => setCollections([]));
  }

  useEffect(() => {
    fetchSessions({ includeTags: true })
      .then(setSessions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchDrivers().then(setDrivers).catch(() => setDrivers([]));
    fetchVehicles().then(setVehicles).catch(() => setVehicles([]));
    fetchTracks().then(setTracks).catch(() => setTracks([]));
    refreshCollections();
  }, []);

  useEffect(() => {
    if (activeCollection == null) {
      setCollectionSessions(null);
      return;
    }
    fetchSmartCollectionSessions(activeCollection)
      .then(setCollectionSessions)
      .catch(() => setCollectionSessions([]));
  }, [activeCollection]);

  function openSaveDialog() {
    setSaveName("");
    setSaveDriver(driverFilter);
    setSaveVehicle(vehicleFilter);
    setSaveTrack("");
    setSaveDateFrom("");
    setSaveDateTo("");
    setSaveMinLaps("");
    setSaveError(null);
    setSaveOpen(true);
  }

  async function submitSave() {
    if (!saveName.trim()) {
      setSaveError("Name is required");
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      const query: SmartCollectionQuery = {
        driver_id: saveDriver === "" ? null : saveDriver,
        vehicle_id: saveVehicle === "" ? null : saveVehicle,
        track_id: saveTrack === "" ? null : saveTrack,
        date_from: saveDateFrom || null,
        date_to: saveDateTo || null,
        min_laps: saveMinLaps === "" ? null : Number(saveMinLaps),
      };
      await createSmartCollection(saveName.trim(), query);
      setSaveOpen(false);
      refreshCollections();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaveBusy(false);
    }
  }

  const baseList = collectionSessions ?? sessions;
  const filtered = baseList.filter((s) => {
    const q = search.toLowerCase();
    const matchesSearch =
      s.venue.toLowerCase().includes(q) ||
      s.driver.toLowerCase().includes(q) ||
      s.file_name.toLowerCase().includes(q) ||
      (s.vehicle && s.vehicle.toLowerCase().includes(q));
    const matchesDriver = driverFilter === "" || s.driver_id === driverFilter;
    const matchesVehicle = vehicleFilter === "" || s.vehicle_id === vehicleFilter;
    const matchesTags =
      activeTags.length === 0 || (s.tags ?? []).some((t) => activeTags.includes(t));
    return matchesSearch && matchesDriver && matchesVehicle && matchesTags;
  });

  // Surface the set of all known tags across the visible session pool so the
  // user can toggle them as chips (independent of the active tag filter).
  const allTags = Array.from(
    new Set(baseList.flatMap((s) => s.tags ?? []))
  ).sort();

  // Always show the most recent session first. Secondary sort: log_time desc.
  const sorted = [...filtered].sort((a, b) => {
    const ad = (a.log_date ?? "") + " " + (a.log_time ?? "");
    const bd = (b.log_date ?? "") + " " + (b.log_time ?? "");
    return bd.localeCompare(ad);
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

      {/* Smart collections — higher-level navigation, placed above filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Collections:</span>
        <Button
          size="sm"
          variant={activeCollection == null ? "default" : "secondary"}
          onClick={() => setActiveCollection(null)}
        >
          All
        </Button>
        {collections.map((c) => (
          <div key={c.id} className="flex items-center gap-1">
            <Button
              size="sm"
              variant={activeCollection === c.id ? "default" : "secondary"}
              onClick={() => setActiveCollection(c.id)}
            >
              {c.name}
            </Button>
            <button
              onClick={async () => {
                await deleteSmartCollection(c.id);
                refreshCollections();
                if (activeCollection === c.id) setActiveCollection(null);
              }}
              className="text-muted-foreground hover:text-red-400"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={openSaveDialog}>
          + Save current filter
        </Button>
      </div>

      {/* Sticky filter toolbar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/40 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search by venue, driver, or file name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
          <Select<number>
            value={driverFilter === "" ? -1 : driverFilter}
            onValueChange={(v) => setDriverFilter(v === -1 ? "" : v)}
            options={[{ value: -1, label: "All drivers" }, ...drivers.map((d) => ({ value: d.id, label: d.name }))]}
          />
          <Select<number>
            value={vehicleFilter === "" ? -1 : vehicleFilter}
            onValueChange={(v) => setVehicleFilter(v === -1 ? "" : v)}
            options={[{ value: -1, label: "All vehicles" }, ...vehicles.map((v) => ({ value: v.id, label: v.name }))]}
          />
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={viewMode === "grid" ? "default" : "secondary"}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              Grid
            </Button>
            <Button
              size="sm"
              variant={viewMode === "list" ? "default" : "secondary"}
              onClick={() => setViewMode("list")}
              aria-label="List view"
            >
              List
            </Button>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Tags:</span>
            {allTags.map((t) => {
              const active = activeTags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setActiveTags((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    )
                  }
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? TAG_STYLE[t] ?? "bg-primary/20 border-primary/40"
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {TAG_LABEL[t] ?? t}
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTags([])}
                className="text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
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

      {!loading && !error && sorted.length === 0 && (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">🏎️</div>
          <h2 className="text-lg font-medium mb-2">
            {search || driverFilter !== "" || vehicleFilter !== ""
              ? "No sessions match your filters"
              : "No sessions yet"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {search || driverFilter !== "" || vehicleFilter !== ""
              ? "Try different search terms or clear the filters."
              : "Upload your first XRK file to get started."}
          </p>
          {!search && driverFilter === "" && vehicleFilter === "" && (
            <Link href="/upload">
              <Button>Upload XRK File</Button>
            </Link>
          )}
        </div>
      )}

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((session) => (
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
                  <div className="mb-2 space-y-1">
                    <AnomalyBadge sessionId={session.id} />
                    <SessionTagBadges sessionId={session.id} tags={session.tags} />
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
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_140px_100px_100px_110px] gap-3 px-4 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <div>Venue / Driver</div>
              <div>Date</div>
              <div>Laps</div>
              <div>Best lap</div>
              <div>Tags</div>
            </div>
            {sorted.map((session) => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="grid grid-cols-[1fr_140px_100px_100px_110px] gap-3 px-4 py-2.5 hover:bg-muted/30 border-b border-border/40 last:border-b-0 text-sm items-center"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {session.venue || "Unknown Venue"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {session.driver || "—"}
                    {session.vehicle && ` · ${session.vehicle}`}
                  </div>
                </div>
                <div className="text-muted-foreground">{session.log_date || "—"}</div>
                <div>{session.lap_count}</div>
                <div className="font-mono text-green-400">
                  {session.best_lap_time_ms != null && session.best_lap_time_ms > 0
                    ? formatLapTime(session.best_lap_time_ms)
                    : "—"}
                </div>
                <div>
                  <SessionTagBadges sessionId={session.id} tags={session.tags} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {saveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !saveBusy && setSaveOpen(false)}
        >
          <Card
            className="w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="p-5 space-y-3">
              <h2 className="font-semibold text-base">New smart collection</h2>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name *</label>
                <Input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. Spa 2024 – wet"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Driver</label>
                  <select
                    value={saveDriver}
                    onChange={(e) => setSaveDriver(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full bg-muted rounded px-2 py-1 text-sm"
                  >
                    <option value="">Any driver</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Vehicle</label>
                  <select
                    value={saveVehicle}
                    onChange={(e) => setSaveVehicle(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full bg-muted rounded px-2 py-1 text-sm"
                  >
                    <option value="">Any vehicle</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-foreground">Track</label>
                  <select
                    value={saveTrack}
                    onChange={(e) => setSaveTrack(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full bg-muted rounded px-2 py-1 text-sm"
                  >
                    <option value="">Any track</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Date from</label>
                  <Input type="date" value={saveDateFrom} onChange={(e) => setSaveDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Date to</label>
                  <Input type="date" value={saveDateTo} onChange={(e) => setSaveDateTo(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Min laps</label>
                  <Input
                    type="number"
                    min={0}
                    value={saveMinLaps}
                    onChange={(e) => setSaveMinLaps(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              {saveError && (
                <p className="text-xs text-destructive">{saveError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSaveOpen(false)}
                  disabled={saveBusy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={submitSave} disabled={saveBusy || !saveName.trim()}>
                  {saveBusy ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
