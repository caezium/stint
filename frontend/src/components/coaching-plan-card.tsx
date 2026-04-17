"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Loader2,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchCoachingPlan,
  regenerateCoachingPlan,
  type CoachingPlan,
  type FocusItem,
  type FocusItemStatus,
} from "@/lib/api";

interface Props {
  sessionId: string;
}

const STATUS_STYLE: Record<FocusItemStatus, string> = {
  open: "bg-muted/40 border-border text-muted-foreground",
  improved: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  same: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  worse: "bg-red-500/15 border-red-500/40 text-red-300",
  abandoned: "bg-muted/30 border-border text-muted-foreground",
};

const STATUS_LABEL: Record<FocusItemStatus, string> = {
  open: "Open",
  improved: "Improved",
  same: "Unchanged",
  worse: "Worse",
  abandoned: "Abandoned",
};

const STATUS_ICON: Record<FocusItemStatus, React.ComponentType<{ className?: string }>> = {
  open: Target,
  improved: ArrowDown,    // lap times go down = better
  same: ArrowRight,
  worse: ArrowUp,
  abandoned: Target,
};

export function CoachingPlanCard({ sessionId }: Props) {
  const [plan, setPlan] = useState<CoachingPlan | null>(null);
  const [prior, setPrior] = useState<CoachingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCoachingPlan(sessionId)
      .then((r) => {
        if (cancelled) return;
        setPlan(r.plan);
        setPrior(r.prior);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const r = await regenerateCoachingPlan(sessionId);
      setPlan(r.plan);
      setPrior(r.prior);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return null;

  // If neither current nor prior, render a low-key placeholder so users know
  // the feature exists but needs an OpenRouter key + a fresh upload.
  const hasContent = !!(plan?.items?.length || prior?.items?.length);
  if (!hasContent && !regenerating) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-medium text-sm flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-primary" /> Coaching plan
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generate 3 measurable focus items for next session. Stint will grade them on your next upload.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={regenerate}>
            Generate
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary" /> Coaching plan
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Persistent goals between sessions
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={regenerate}
          disabled={regenerating}
        >
          {regenerating ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Working…
            </>
          ) : (
            "Regenerate"
          )}
        </Button>
      </div>

      {prior && prior.items.length > 0 && (
        <PriorResults plan={prior} />
      )}
      {plan && plan.items.length > 0 && (
        <NextFocus plan={plan} />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PriorResults({ plan }: { plan: CoachingPlan }) {
  const counts = plan.items.reduce(
    (acc, it) => {
      acc[it.status] = (acc[it.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<FocusItemStatus, number>,
  );
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="text-xs font-medium text-foreground">Last session's focus → results</h4>
        {(["improved", "same", "worse"] as const).map((s) =>
          counts[s] ? (
            <Badge
              key={s}
              variant="outline"
              className={`text-[10px] h-4 ${STATUS_STYLE[s]}`}
            >
              {counts[s]} {STATUS_LABEL[s].toLowerCase()}
            </Badge>
          ) : null,
        )}
      </div>
      <ul className="space-y-1.5">
        {plan.items.map((it) => (
          <FocusRow key={it.id} item={it} showResult />
        ))}
      </ul>
    </div>
  );
}

function NextFocus({ plan }: { plan: CoachingPlan }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-foreground mb-1.5">
        Focus for next session
      </h4>
      <ul className="space-y-1.5">
        {plan.items.map((it) => (
          <FocusRow key={it.id} item={it} />
        ))}
      </ul>
    </div>
  );
}

function FocusRow({ item, showResult }: { item: FocusItem; showResult?: boolean }) {
  const Icon = STATUS_ICON[item.status];
  const ev = item.evaluation;
  return (
    <li
      className={`rounded border px-2.5 py-1.5 text-xs flex items-start gap-2 ${
        STATUS_STYLE[item.status]
      }`}
    >
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-foreground">{item.item_text}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
          {item.target_metric}
          {item.target_value != null && ` → ${formatTarget(item.target_metric, item.target_value)}`}
          {showResult && ev && ev.before != null && ev.after != null && (
            <>
              {" "}· {formatTarget(item.target_metric, ev.before)} →{" "}
              {formatTarget(item.target_metric, ev.after)}
              {ev.delta != null && (
                <span className="ml-1">
                  ({ev.delta > 0 ? "+" : ""}
                  {formatDelta(item.target_metric, ev.delta)})
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {showResult && (
        <Badge
          variant="outline"
          className={`text-[9px] h-4 ${STATUS_STYLE[item.status]}`}
        >
          {STATUS_LABEL[item.status]}
          {item.status === "improved" && (() => {
            const d = ev?.delta;
            return d != null ? ` ${formatDelta(item.target_metric, d)}` : "";
          })()}
        </Badge>
      )}
    </li>
  );
}

function formatTarget(metric: string, v: number): string {
  if (metric.endsWith("_ms")) return `${(v / 1000).toFixed(3)}s`;
  if (metric.endsWith("_pct")) return `${v.toFixed(1)}%`;
  return v.toFixed(3);
}

function formatDelta(metric: string, v: number): string {
  if (metric.endsWith("_ms")) {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${(v / 1000).toFixed(3)}s`;
  }
  if (metric.endsWith("_pct")) {
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(1)}%`;
  }
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(3)}`;
}
