"use client";

import { useState, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { CHANNEL_CATEGORIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/api";

interface ChannelBrowserProps {
  activeChannels: string[];
  onToggleChannel: (name: string) => void;
}

export function ChannelBrowser({
  activeChannels,
  onToggleChannel,
}: ChannelBrowserProps) {
  const session = useSessionStore((s) => s.session);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    if (!session) return {};
    return groupByCategory(session.channels);
  }, [session]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    const result: Record<string, Channel[]> = {};
    for (const [cat, channels] of Object.entries(grouped)) {
      const match = channels.filter((ch) =>
        ch.name.toLowerCase().includes(q)
      );
      if (match.length > 0) result[cat] = match;
    }
    return result;
  }, [grouped, search]);

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
                    return (
                      <button
                        key={ch.name}
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
                        className={cn(
                          "flex items-center justify-between px-3 py-1 text-xs transition-colors cursor-grab active:cursor-grabbing",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                        )}
                      >
                        <span className="truncate">{ch.name}</span>
                        {ch.units && (
                          <span className="text-[10px] opacity-50 ml-2 shrink-0">
                            {ch.units}
                          </span>
                        )}
                      </button>
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
