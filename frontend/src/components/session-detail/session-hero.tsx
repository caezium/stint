"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight, MessageSquare, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SessionTagBadges } from "@/components/session-tag-badges";
import { AssignmentPopover } from "@/components/session-detail/assignment-popover";
import type { Driver, SessionDetail, Track, Vehicle } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface Props {
  session: SessionDetail;
  drivers: Driver[];
  vehicles: Vehicle[];
  assignedTrack: Track | null;
  onAssignDriver: (id: number | null) => Promise<void> | void;
  onAssignVehicle: (id: number | null) => Promise<void> | void;
  onOpenChat: () => void;
  onRecomputeFromTrack?: () => void;
  recomputeMsg?: string | null;
  validLapCount: number;
  bestMs: number | null;
  durationMs: number | null;
}

/**
 * The top "hero" block on the redesigned session detail page. Composes:
 * - venue + date + tags (left)
 * - key stats (best lap / laps / duration) (middle)
 * - driver / vehicle / logger assignment (right)
 * - action chip row (below)
 */
export const SessionHero = forwardRef<HTMLDivElement, Props>(function SessionHero(
  {
    session,
    drivers,
    vehicles,
    assignedTrack,
    onAssignDriver,
    onAssignVehicle,
    onOpenChat,
    onRecomputeFromTrack,
    recomputeMsg,
    validLapCount,
    bestMs,
    durationMs,
  },
  ref,
) {
  return (
    <div ref={ref}>
      <Card className="overflow-visible">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-6 lg:gap-8 items-start">
            {/* Left: venue / date / tags / track */}
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight truncate">
                {session.venue || "Session"}
              </h1>
              <div className="mt-1 text-sm text-muted-foreground">
                {session.log_date}
                {session.log_time && ` · ${session.log_time}`}
              </div>
              <div className="mt-3">
                <SessionTagBadges sessionId={session.id} />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {assignedTrack ? (
                  <>
                    track:{" "}
                    <Link
                      href={`/tracks/${assignedTrack.id}/edit`}
                      className="text-foreground hover:underline"
                    >
                      {assignedTrack.name}
                    </Link>
                    {assignedTrack.sf_line && (
                      <Badge
                        variant="outline"
                        className="ml-2 text-[9px] h-4 bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      >
                        S/F configured
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="italic">no track assigned</span>
                )}
              </div>
            </div>

            {/* Middle: key stats */}
            <div className="flex items-start gap-6 lg:gap-8 lg:border-l lg:border-border/40 lg:pl-8">
              <StatCell label="Best lap" value={bestMs ? formatLapTime(bestMs) : "—"} emphasis />
              <StatCell label="Laps" value={String(validLapCount)} />
              <StatCell
                label="Duration"
                value={durationMs ? formatLapTime(durationMs) : "—"}
              />
            </div>

            {/* Right: assignment block */}
            <div className="space-y-1.5 lg:min-w-[200px] lg:border-l lg:border-border/40 lg:pl-6">
              <AssignmentRow label="Driver">
                <AssignmentPopover
                  label="Driver"
                  current={session.driver}
                  currentId={session.driver_id}
                  options={drivers}
                  onAssign={onAssignDriver}
                />
              </AssignmentRow>
              <AssignmentRow label="Vehicle">
                <AssignmentPopover
                  label="Vehicle"
                  current={session.vehicle}
                  currentId={session.vehicle_id}
                  options={vehicles}
                  onAssign={onAssignVehicle}
                />
              </AssignmentRow>
              <AssignmentRow label="Logger">
                <span className="text-sm text-muted-foreground">
                  {session.logger_model || "—"}
                </span>
              </AssignmentRow>
            </div>
          </div>

          {/* Action chip row */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onOpenChat}>
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Ask AI about this session
            </Button>
            <Link href={`/sessions/${session.id}/analysis`}>
              <Button size="sm" variant="secondary">
                Open Analysis
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
            {assignedTrack && (
              <Link href={`/tracks/${assignedTrack.id}/edit`}>
                <Button size="sm" variant="outline">
                  <Pencil className="h-3 w-3 mr-1" />
                  Edit track
                </Button>
              </Link>
            )}
            {onRecomputeFromTrack && assignedTrack?.sf_line && (
              <Button size="sm" variant="outline" onClick={onRecomputeFromTrack}>
                Recompute from track
              </Button>
            )}
            {recomputeMsg && (
              <span className="text-xs text-muted-foreground">{recomputeMsg}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

function StatCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono tabular-nums ${
          emphasis ? "text-2xl font-semibold text-emerald-300" : "text-xl"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function AssignmentRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
