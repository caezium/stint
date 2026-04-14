"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSessionStore } from "@/stores/session-store";
import { useLapStore } from "@/stores/lap-store";
import { useChannelDataStore } from "@/stores/channel-data-store";
import { formatLapTime } from "@/lib/constants";
import { AnalysisWorkspace } from "@/components/analysis-workspace";

export default function AnalysisPage() {
  const params = useParams();
  const id = params.id as string;

  const { session, loading, error, loadSession } = useSessionStore();
  const { autoSelectBest, reset: resetLaps } = useLapStore();
  const clearChannels = useChannelDataStore((s) => s.clear);

  // Load session on mount
  useEffect(() => {
    if (id) {
      clearChannels();
      resetLaps();
      loadSession(id);
    }
  }, [id, loadSession, clearChannels, resetLaps]);

  // Auto-select best lap once session loads
  useEffect(() => {
    if (session?.laps) {
      autoSelectBest(session.laps);
    }
  }, [session?.laps, autoSelectBest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-muted-foreground">
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
        Loading session...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)]">
        <p className="text-destructive mb-2">Failed to load session</p>
        <p className="text-muted-foreground text-sm mb-4">{error}</p>
        <Link
          href="/sessions"
          className="text-sm text-primary hover:underline"
        >
          Back to Sessions
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href={`/sessions/${id}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back
          </Link>
          <div>
            <span className="font-semibold text-sm">
              {session.venue || "Session"}
            </span>
            <span className="text-muted-foreground text-xs ml-2">
              {session.driver && `${session.driver} \u2022 `}
              {session.log_date}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{session.lap_count} laps</span>
          {session.best_lap_time_ms && (
            <span className="text-green-400 font-mono">
              Best: {formatLapTime(session.best_lap_time_ms)}
            </span>
          )}
          <span>{session.channels.length} channels</span>
        </div>
      </div>

      {/* Workspace */}
      <AnalysisWorkspace sessionId={id} />
    </div>
  );
}
