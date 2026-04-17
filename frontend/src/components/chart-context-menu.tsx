"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Crosshair } from "lucide-react";

export interface ChartContextItem {
  label: string;
  icon?: "chat" | "cursor";
  onSelect: () => void;
}

interface ChartContextMenuState {
  x: number;
  y: number;
  items: ChartContextItem[];
}

interface Props {
  state: ChartContextMenuState | null;
  onClose: () => void;
}

const ICONS = {
  chat: MessageSquare,
  cursor: Crosshair,
};

/**
 * Tiny popover used by chart components on right-click. Positioned at
 * `state.x/y`, auto-closes on outside-click / escape / scroll.
 */
export function ChartContextMenu({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Reposition to keep the menu inside the viewport
  useEffect(() => {
    if (!state || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    let left = state.x;
    let top = state.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    setPos({ left, top });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    function onAnything(e: Event) {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (
        e.type === "mousedown" &&
        ref.current &&
        ref.current.contains(e.target as Node)
      )
        return;
      onClose();
    }
    document.addEventListener("mousedown", onAnything);
    document.addEventListener("keydown", onAnything);
    document.addEventListener("scroll", onAnything, true);
    document.addEventListener("contextmenu", (e) => {
      // closing on a different contextmenu is normal — but if it's targeted at
      // the chart container itself, the parent will reopen us with new coords
      onClose();
    });
    return () => {
      document.removeEventListener("mousedown", onAnything);
      document.removeEventListener("keydown", onAnything);
      document.removeEventListener("scroll", onAnything, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        left: pos?.left ?? state.x,
        top: pos?.top ?? state.y,
        visibility: pos ? "visible" : "hidden",
      }}
      className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover shadow-2xl py-1 text-sm"
    >
      {state.items.map((item, i) => {
        const Icon = item.icon ? ICONS[item.icon] : null;
        return (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60 transition-colors"
          >
            {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Re-export the type so callers can use it
export type { ChartContextMenuState };
