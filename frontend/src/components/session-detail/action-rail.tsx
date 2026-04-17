"use client";

import Link from "next/link";
import {
  BarChart3,
  Download,
  FileText,
  MessageSquare,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getExportPdfUrl } from "@/lib/api";

interface Props {
  sessionId: string;
  hasTrack: boolean;
  hasSfLine: boolean;
  trackId?: number | null;
  onOpenChat: () => void;
  onRecomputeFromTrack?: () => void;
  onRegenerateDebrief: () => void;
  recomputeMsg?: string | null;
  debriefRecomputing?: boolean;
}

/**
 * Strava-style right-docked action rail. Stays visible as the user scrolls
 * through the session analytics. Primary action is "Ask AI", then Analysis,
 * then utilities (PDF, recompute, track edit).
 */
export function ActionRail({
  sessionId,
  hasTrack,
  hasSfLine,
  trackId,
  onOpenChat,
  onRecomputeFromTrack,
  onRegenerateDebrief,
  recomputeMsg,
  debriefRecomputing,
}: Props) {
  return (
    <div className="space-y-3">
      {/* Primary action */}
      <Button onClick={onOpenChat} className="w-full justify-start gap-2" size="lg">
        <Sparkles className="h-4 w-4" />
        <div className="flex flex-col items-start leading-tight">
          <span className="text-sm font-semibold">Ask Stint</span>
          <span className="text-[10px] opacity-80 font-normal">
            Coach this session
          </span>
        </div>
      </Button>

      <Link href={`/sessions/${sessionId}/analysis`} className="block">
        <Button variant="secondary" className="w-full justify-start gap-2">
          <BarChart3 className="h-4 w-4" />
          Open telemetry workspace
        </Button>
      </Link>

      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Utilities
        </div>
        <a href={getExportPdfUrl(sessionId)} target="_blank" rel="noopener">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF report
          </Button>
        </a>
        <a
          href={`/api/sessions/${sessionId}/export.csv`}
          target="_blank"
          rel="noopener"
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs"
          onClick={onRegenerateDebrief}
          disabled={debriefRecomputing}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {debriefRecomputing ? "Regenerating…" : "Regenerate debrief"}
        </Button>
        {hasTrack && trackId != null && (
          <Link href={`/tracks/${trackId}/edit`} className="block">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit track
            </Button>
          </Link>
        )}
        {hasSfLine && onRecomputeFromTrack && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={onRecomputeFromTrack}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Recompute from track
          </Button>
        )}
        {recomputeMsg && (
          <div className="text-[10px] text-muted-foreground pl-1">
            {recomputeMsg}
          </div>
        )}
      </div>
    </div>
  );
}
