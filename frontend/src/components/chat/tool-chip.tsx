"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Layers,
  ListOrdered,
  type LucideIcon,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";

interface ToolPart {
  type: string;          // e.g. "tool-get_lap_stats"
  toolCallId?: string;
  toolName?: string;
  state?: string;        // input-streaming | input-available | output-available | output-error
  input?: unknown;
  output?: unknown;
  errorText?: string;
  summary?: string;      // injected client-side via data-tool-summary
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  get_session_overview: Sparkles,
  list_laps: ListOrdered,
  get_lap_stats: BarChart3,
  compare_laps_delta: GitCompareArrows,
  get_sector_times: Layers,
  get_anomalies: AlertTriangle,
  get_debrief: Sparkles,
  sample_channel_on_lap: Activity,
  get_coaching_points: Wrench,
  find_similar_sessions: Search,
  compare_sessions: GitCompareArrows,
  personal_best_sector: BarChart3,
  get_session_history: ListOrdered,
  get_fingerprint_evolution: Activity,
  apply_layout: Layers,
  apply_math_channel: Wrench,
};

export function ToolChip({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState(false);

  const name = part.toolName ?? part.type.replace(/^tool-/, "");
  const Icon = TOOL_ICONS[name] ?? Wrench;

  const hasError = part.state === "output-error" || !!part.errorText;
  const isWaiting = part.state !== "output-available" && part.state !== "output-error";

  return (
    <div
      className={`rounded border bg-background/40 overflow-hidden text-xs ${
        hasError ? "border-destructive/40" : "border-border"
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-2 py-1 flex items-center gap-2 hover:bg-muted/50 transition-colors"
      >
        <Icon className={`h-3.5 w-3.5 ${hasError ? "text-destructive" : "text-blue-400"}`} />
        <span className="font-mono text-[11px] text-foreground">{name}</span>
        {part.summary && !expanded && (
          <span className="truncate text-muted-foreground">— {part.summary}</span>
        )}
        {isWaiting && !hasError && (
          <span className="ml-auto text-[10px] text-muted-foreground animate-pulse">
            running…
          </span>
        )}
        {!isWaiting && (
          <span className="ml-auto text-muted-foreground">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-2 py-1 space-y-1.5 text-[10px] font-mono">
          {part.input !== undefined && (
            <div>
              <div className="text-muted-foreground mb-0.5">input</div>
              <pre className="whitespace-pre-wrap break-words bg-black/30 rounded p-1">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {part.output !== undefined && (
            <div>
              <div className="text-muted-foreground mb-0.5">output</div>
              <pre className="whitespace-pre-wrap break-words bg-black/30 rounded p-1 max-h-48 overflow-auto">
                {JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
          )}
          {part.errorText && (
            <div className="text-destructive">{part.errorText}</div>
          )}
        </div>
      )}
    </div>
  );
}
