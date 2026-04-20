"use client";

import { useState, useMemo, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { CHANNEL_CATEGORIES, DEFAULT_MATH_CHANNELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/api";

interface ChannelBrowserProps {
  activeChannels: string[];
  onToggleChannel: (name: string) => void;
  /** Persist per-session hidden channels under this key. */
  sessionId?: string;
}

const DEFAULT_MATH_VIRTUAL: Channel[] = DEFAULT_MATH_CHANNELS.map((c) => ({
  name: c.name,
  units: c.units,
  dec_pts: 3,
  sample_count: 1,
  interpolate: true,
  function_name: "",
  category: "Math (Default)",
}));

export function ChannelBrowser({
  activeChannels,
  onToggleChannel,
  sessionId,
}: ChannelBrowserProps) {
  const session = useSessionStore((s) => s.session);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Load hidden set from localStorage
  useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`stint-hidden-channels-${sessionId}`);
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, [sessionId]);

  function toggleHidden(name: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        if (sessionId) {
          window.localStorage.setItem(
            `stint-hidden-channels-${sessionId}`,
            JSON.stringify(Array.from(next)),
          );
        }
      } catch { /* ignore */ }
      return next;
    });
  }

  const grouped = useMemo(() => {
    if (!session) return {};
    const existingNames = new Set(session.channels.map((c) => c.name));
    const merged = [
      ...session.channels,
      ...DEFAULT_MATH_VIRTUAL.filter((c) => !existingNames.has(c.name)),
    ];
    return groupByCategory(merged);
  }, [session]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result: Record<string, Channel[]> = {};
    for (const [cat, channels] of Object.entries(grouped)) {
      const match = channels.filter((ch) => {
        if (!showHidden && hidden.has(ch.name)) return false;
        if (q && !ch.name.toLowerCase().includes(q)) return false;
        return true;
      });
      if (match.length > 0) result[cat] = match;
    }
    return result;
  }, [grouped, search, hidden, showHidden]);

  if (!session) return null;

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pb-1">
        Channels
      </h3>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter channels..."
        className="mx-2 mb-1 px-2 py-1 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {hidden.size > 0 && (
        <button
          onClick={() => setShowHidden((v) => !v)}
          className="mx-2 mb-1 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground rounded text-left"
        >
          {showHidden ? "Hide" : "Show"} {hidden.size} hidden channel
          {hidden.size === 1 ? "" : "s"}
        </button>
      )}
      <div className="overflow-y-auto flex-1">
        {Object.entries(filtered).map(([category, channels]) => {
          const isCollapsed = collapsed[category] ?? false;
          return (
            <div key={category} className="mb-1">
              <button
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [category]: !isCollapsed }))
                }
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              >
                <span
                  className={cn(
                    "transition-transform text-[10px]",
                    isCollapsed ? "rotate-0" : "rotate-90"
                  )}
                >
                  &#9654;
                </span>
                {category}
                <span className="text-[10px] ml-auto opacity-60">
                  {channels.length}
                </span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-col">
                  {channels.map((ch) => {
                    const isActive = activeChannels.includes(ch.name);
                    const isHidden = hidden.has(ch.name);
                    return (
                      <div
                        key={ch.name}
                        className={cn(
                          "group flex items-center text-xs transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                          isHidden && "opacity-50 italic",
                        )}
                      >
                        <button
                          onClick={() => onToggleChannel(ch.name)}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "application/x-channel",
                              ch.name
                            );
                            e.dataTransfer.setData("text/plain", ch.name);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          className="flex items-center justify-between flex-1 min-w-0 px-3 py-1 cursor-grab active:cursor-grabbing"
                        >
                          <span className="truncate text-left">{ch.name}</span>
                          {ch.units && (
                            <span className="text-[10px] opacity-50 ml-2 shrink-0">
                              {ch.units}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHidden(ch.name);
                          }}
                          className="px-1.5 py-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          title={isHidden ? "Show channel" : "Hide channel"}
                          aria-label={isHidden ? "Show channel" : "Hide channel"}
                        >
                          {isHidden ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupByCategory(channels: Channel[]): Record<string, Channel[]> {
  const result: Record<string, Channel[]> = {};

  for (const ch of channels) {
    let matched = false;
    for (const [category, patterns] of Object.entries(CHANNEL_CATEGORIES)) {
      if (category === "Other") continue;
      if (
        patterns.some((p) => ch.name.toLowerCase().includes(p.toLowerCase()))
      ) {
        if (!result[category]) result[category] = [];
        result[category].push(ch);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!result["Other"]) result["Other"] = [];
      result["Other"].push(ch);
    }
  }

  return result;
}
