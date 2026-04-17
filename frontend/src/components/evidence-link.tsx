"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

interface Props {
  sessionId: string;
  lapNum?: number | null;
  distancePct?: number | null;
  /** Optional inline label — defaults to "L{n}" / "L{n} · {pct}%". */
  children?: React.ReactNode;
}

/**
 * Clickable reference (T1.7) — lands the user on the analysis workspace
 * with the lap pre-selected and the cursor at the offending distance.
 *
 * The workspace reads `?lap=N&pct=X` on mount and applies them to
 * `useLapStore` + `useCursorStore`.
 */
export function EvidenceLink({ sessionId, lapNum, distancePct, children }: Props) {
  const router = useRouter();
  if (lapNum == null) return <>{children ?? null}</>;

  const label =
    children ??
    (distancePct != null
      ? `L${lapNum} · ${distancePct.toFixed(0)}%`
      : `L${lapNum}`);

  function go() {
    const params = new URLSearchParams();
    params.set("lap", String(lapNum));
    if (distancePct != null) params.set("pct", String(Math.round(distancePct)));
    router.push(`/sessions/${sessionId}/analysis?${params.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={go}
      className="inline-flex items-center gap-0.5 underline text-primary hover:text-primary/80"
    >
      {label}
      <ArrowUpRight className="h-3 w-3" />
    </button>
  );
}
