"use client";

import { useEffect, useState } from "react";
import { fetchAnomalySummary, type AnomalyCounts } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

interface Props {
  sessionId: string;
  /** Suppress badge when the session is clean (no anomalies). */
  hideWhenClean?: boolean;
}

/**
 * Compact severity pill rendered on session cards. Fires one lightweight
 * summary request. Stays silent when the session has no anomalies unless
 * hideWhenClean is set to false.
 */
export function AnomalyBadge({ sessionId, hideWhenClean = true }: Props) {
  const [counts, setCounts] = useState<AnomalyCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAnomalySummary(sessionId)
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!counts) return null;
  const total = counts.critical + counts.warning + counts.info;
  if (total === 0) {
    if (hideWhenClean) return null;
    return (
      <Badge variant="secondary" className="text-xs">
        <span className="mr-1">✓</span>No issues
      </Badge>
    );
  }

  if (counts.critical > 0) {
    return (
      <Badge variant="destructive" className="text-xs">
        <span className="mr-1">●</span>
        {counts.critical} critical{counts.warning ? ` · ${counts.warning} warn` : ""}
      </Badge>
    );
  }

  if (counts.warning > 0) {
    return (
      <Badge
        variant="outline"
        className="text-xs border-amber-500/50 text-amber-400"
      >
        <span className="mr-1">●</span>
        {counts.warning} warning{counts.warning > 1 ? "s" : ""}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-xs text-muted-foreground">
      <span className="mr-1">○</span>
      {counts.info} note{counts.info > 1 ? "s" : ""}
    </Badge>
  );
}
