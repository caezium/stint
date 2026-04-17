"use client";

import { useEffect, useState } from "react";
import {
  Calculator,
  Check,
  LayoutDashboard,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createMathChannel,
  saveLayout,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// T4.2 — Layout proposal
// ---------------------------------------------------------------------------

interface LayoutInput {
  name?: string;
  charts?: Array<{
    type?: string;
    channels?: string[];
    options?: Record<string, unknown>;
  }>;
}

export function LayoutProposalCard({
  sessionId,
  input,
  output,
}: {
  sessionId: string;
  input: LayoutInput;
  output?: { status?: string; layout_id?: number };
}) {
  const [state, setState] = useState<"idle" | "applying" | "applied" | "dismissed" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const charts = input.charts ?? [];
  const name = input.name ?? "Untitled layout";

  // Already-applied detection from localStorage marker
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `stint-layout-applied-${output?.layout_id ?? ""}-${name}`;
    if (window.localStorage.getItem(key) === "1") setState("applied");
  }, [output?.layout_id, name]);

  async function apply() {
    setState("applying");
    setError(null);
    try {
      // Persist to the layouts table (without the [proposed] prefix)
      await saveLayout(name, { charts });
      // Drop the layout straight into the analysis workspace's storage so it
      // takes effect on the next render. The workspace reads
      // `stint-charts-${sessionId}` on mount.
      try {
        window.localStorage.setItem(
          `stint-charts-${sessionId}`,
          JSON.stringify(charts),
        );
        window.localStorage.setItem(
          `stint-layout-applied-${output?.layout_id ?? ""}-${name}`,
          "1",
        );
        // Notify any listening AnalysisWorkspace to reload its layout
        window.dispatchEvent(
          new CustomEvent("stint:layout-applied", { detail: { sessionId, charts } }),
        );
      } catch {
        /* localStorage might be disabled */
      }
      setState("applied");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply layout");
      setState("error");
    }
  }

  if (state === "dismissed") return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 my-1.5 space-y-2">
      <div className="flex items-start gap-2">
        <LayoutDashboard className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Layout proposal: {name}</div>
          <div className="text-xs text-muted-foreground">
            {charts.length} chart{charts.length === 1 ? "" : "s"}
          </div>
        </div>
        {state !== "applied" && state !== "applying" && (
          <button
            onClick={() => setState("dismissed")}
            className="text-muted-foreground/60 hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {charts.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-0.5 pl-6 list-disc">
          {charts.slice(0, 6).map((c, i) => (
            <li key={i}>
              <span className="font-mono">{c.type ?? "chart"}</span>
              {c.channels?.length ? ` · ${c.channels.join(", ")}` : ""}
            </li>
          ))}
          {charts.length > 6 && (
            <li className="text-muted-foreground/60">
              + {charts.length - 6} more
            </li>
          )}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={apply}
          disabled={state === "applying" || state === "applied"}
        >
          {state === "applying" ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Applying…
            </>
          ) : state === "applied" ? (
            <>
              <Check className="h-3 w-3 mr-1" /> Applied
            </>
          ) : (
            "Apply layout"
          )}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T4.5 — Math channel proposal
// ---------------------------------------------------------------------------

interface MathChannelInput {
  name?: string;
  expression?: string;
}

export function MathChannelProposalCard({
  sessionId,
  input,
}: {
  sessionId: string;
  input: MathChannelInput;
}) {
  const [state, setState] = useState<"idle" | "applying" | "applied" | "dismissed" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const name = input.name ?? "math_channel";
  const expression = input.expression ?? "";

  async function apply() {
    setState("applying");
    setError(null);
    try {
      await createMathChannel(sessionId, name, expression);
      setState("applied");
      // Tell the workspace to reload its math channels
      window.dispatchEvent(
        new CustomEvent("stint:math-channel-applied", { detail: { sessionId, name } }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply math channel");
      setState("error");
    }
  }

  if (state === "dismissed") return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 my-1.5 space-y-2">
      <div className="flex items-start gap-2">
        <Calculator className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Math channel proposal: {name}</div>
          <div className="text-xs text-muted-foreground font-mono break-all">
            {expression || "(no expression)"}
          </div>
        </div>
        {state !== "applied" && state !== "applying" && (
          <button
            onClick={() => setState("dismissed")}
            className="text-muted-foreground/60 hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={apply}
          disabled={state === "applying" || state === "applied" || !expression}
        >
          {state === "applying" ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Applying…
            </>
          ) : state === "applied" ? (
            <>
              <Check className="h-3 w-3 mr-1" /> Applied
            </>
          ) : (
            "Add math channel"
          )}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
