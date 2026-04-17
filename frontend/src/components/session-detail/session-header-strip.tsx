"use client";

import { forwardRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SessionDetail, Track, TrackData, Driver, Vehicle } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { SessionTagBadges } from "@/components/session-tag-badges";
import { AssignmentPopover } from "@/components/session-detail/assignment-popover";

const TrackMapLeaflet = dynamic(() => import("@/components/track-map-leaflet"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-muted text-[10px] text-muted-foreground">
      …
    </div>
  ),
});

interface Props {
  session: SessionDetail;
  assignedTrack: Track | null;
  track: TrackData | null;
  drivers: Driver[];
  vehicles: Vehicle[];
  onAssignDriver: (id: number | null) => Promise<void> | void;
  onAssignVehicle: (id: number | null) => Promise<void> | void;
  validLapCount: number;
  bestMs: number | null;
  durationMs: number | null;
  cleanLapCount: number | null;
  covPct: number | null;
}

/**
 * Strava-style dense session header. One horizontal strip (≈120px tall)
 * containing: track thumbnail, title/date/tags, a row of key stats, and an
 * inline driver/vehicle assignment. Replaces the giant v1 hero card.
 */
export const SessionHeaderStrip = forwardRef<HTMLDivElement, Props>(function SessionHeaderStrip(
  {
    session,
    assignedTrack,
    track,
    drivers,
    vehicles,
    onAssignDriver,
    onAssignVehicle,
    validLapCount,
    bestMs,
    durationMs,
    cleanLapCount,
    covPct,
  },
  ref,
) {
  const hasTrack = track && track.lat.length > 0;

  return (
    <div
      ref={ref}
      className="rounded-xl border border-border/60 bg-card/40 overflow-hidden"
    >
      <div className="flex items-stretch">
        {/* Track thumbnail */}
        <div className="w-[140px] h-[140px] shrink-0 relative bg-muted/20 hidden sm:block">
          {hasTrack ? (
            <TrackMapLeaflet
              outline={track!.lat.map((la, i) => [la, track!.lon[i]])}
              speed={track!.speed}
              height="100%"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground/60">
              no GPS
            </div>
          )}
        </div>

        {/* Title / date / assignment row */}
        <div className="flex-1 min-w-0 p-4 flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate leading-tight">
                {session.venue || "Session"}
              </h1>
              <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>
                  {session.log_date}
                  {session.log_time && ` · ${session.log_time}`}
                </span>
                {assignedTrack && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <Link
                      href={`/tracks/${assignedTrack.id}/edit`}
                      className="hover:text-foreground hover:underline"
                    >
                      {assignedTrack.name}
                    </Link>
                  </>
                )}
              </div>
              <div className="mt-1.5">
                <SessionTagBadges sessionId={session.id} />
              </div>
            </div>

            <div className="text-right text-xs space-y-0.5 shrink-0">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-muted-foreground">Driver</span>
                <AssignmentPopover
                  label="Driver"
                  current={session.driver}
                  currentId={session.driver_id}
                  options={drivers}
                  onAssign={onAssignDriver}
                />
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-muted-foreground">Vehicle</span>
                <AssignmentPopover
                  label="Vehicle"
                  current={session.vehicle}
                  currentId={session.vehicle_id}
                  options={vehicles}
                  onAssign={onAssignVehicle}
                />
              </div>
            </div>
          </div>

          {/* Key stats row */}
          <div className="flex items-baseline gap-6 pt-1">
            <Stat
              label="Best lap"
              value={bestMs ? formatLapTime(bestMs) : "—"}
              accent
            />
            <StatDivider />
            <Stat label="Laps" value={String(validLapCount)} />
            {cleanLapCount != null && (
              <>
                <StatDivider />
                <Stat
                  label="Clean"
                  value={`${cleanLapCount}/${validLapCount}`}
                />
              </>
            )}
            {covPct != null && (
              <>
                <StatDivider />
                <Stat
                  label="COV"
                  value={`${covPct.toFixed(2)}%`}
                  tone={
                    covPct < 1.5
                      ? "good"
                      : covPct < 3
                        ? "neutral"
                        : "bad"
                  }
                />
              </>
            )}
            <StatDivider />
            <Stat
              label="Duration"
              value={durationMs ? formatLapTime(durationMs) : "—"}
            />
            <StatDivider />
            <Stat
              label="Logger"
              value={session.logger_model || "—"}
              size="sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
});

function Stat({
  label,
  value,
  accent,
  tone,
  size,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "good" | "neutral" | "bad";
  size?: "sm" | "md";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-amber-300"
        : accent
          ? "text-emerald-300 font-semibold"
          : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div
        className={`font-mono tabular-nums mt-0.5 ${
          size === "sm" ? "text-sm" : accent ? "text-xl" : "text-lg"
        } ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function StatDivider() {
  return <div className="h-8 w-px bg-border/40 self-center" />;
}
