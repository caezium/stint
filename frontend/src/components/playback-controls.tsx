"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useCursorStore } from "@/stores/cursor-store";

interface Props {
  /** Full duration of the current lap in ms. Used as the scrub upper bound. */
  durationMs: number;
  /** Optional compact mode (hides labels) */
  compact?: boolean;
}

const SPEEDS: number[] = [0.25, 0.5, 1, 2, 4];

/**
 * Play / pause / scrub control that advances the shared `cursorMs` store,
 * driving the track-map dot + chart cursor in sync. Phase 13.3.
 */
export function PlaybackControls({ durationMs, compact = false }: Props) {
  const cursorMs = useCursorStore((s) => s.cursorMs);
  const setCursorMs = useCursorStore((s) => s.setCursorMs);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // Guard: never crash when durationMs is unknown or 0.
  const safeDuration = Math.max(1, durationMs);

  const tick = useCallback(
    (now: number) => {
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const advance = dt * speed;
      const current = cursorMs ?? 0;
      const next = current + advance;
      if (next >= safeDuration) {
        setCursorMs(safeDuration);
        setPlaying(false);
        return;
      }
      setCursorMs(next);
      rafRef.current = requestAnimationFrame(tick);
    },
    [cursorMs, safeDuration, setCursorMs, speed]
  );

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, tick]);

  const pct =
    cursorMs == null ? 0 : Math.max(0, Math.min(1, cursorMs / safeDuration));

  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => {
          if (cursorMs == null || cursorMs >= safeDuration) {
            setCursorMs(0);
          }
          setPlaying((v) => !v);
        }}
        className="rounded-sm bg-muted/50 hover:bg-muted p-1"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={() => {
          setCursorMs(0);
          setPlaying(false);
        }}
        className="rounded-sm bg-muted/50 hover:bg-muted p-1"
        aria-label="Reset"
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      <input
        type="range"
        min={0}
        max={safeDuration}
        step={10}
        value={cursorMs ?? 0}
        onChange={(e) => {
          setCursorMs(Number(e.target.value));
          setPlaying(false);
        }}
        className="flex-1 h-1 accent-primary"
        aria-label="Scrub"
      />

      {!compact && (
        <div className="w-14 text-right font-mono tabular-nums text-muted-foreground text-[10px]">
          {((cursorMs ?? 0) / 1000).toFixed(2)}s
        </div>
      )}

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="bg-muted rounded px-1 py-0.5 text-[10px] cursor-pointer"
        aria-label="Playback speed"
        title="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      {/* Hidden label to aid screen readers; visually track via the slider */}
      <span className="sr-only">
        Playback at {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}
