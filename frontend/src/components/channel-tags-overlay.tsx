"use client";

import { useEffect, useState } from "react";
import { useCursorStore } from "@/stores/cursor-store";
import { fetchResampledData, type ResampledData } from "@/lib/api";
import { Pin, PinOff } from "lucide-react";

interface Props {
  sessionId: string;
  lapNum: number | null;
  channels: string[];
}

/**
 * Pinned overlay showing each channel's live cursor value, plus session
 * min/max/avg stats alongside. Lightweight — the cursor value is looked up
 * by binary search against the pre-fetched resampled lap data. (Phase 16.6)
 */
export function ChannelTagsOverlay({ sessionId, lapNum, channels }: Props) {
  const [data, setData] = useState<ResampledData | null>(null);
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("stint-chtags-pinned") === "1";
  });
  const cursorMs = useCursorStore((s) => s.cursorMs);

  useEffect(() => {
    try {
      localStorage.setItem("stint-chtags-pinned", pinned ? "1" : "0");
    } catch {}
  }, [pinned]);

  useEffect(() => {
    if (!pinned || !lapNum || channels.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetchResampledData(sessionId, channels, lapNum)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [sessionId, lapNum, channels, pinned]);

  if (!pinned) {
    return (
      <button
        type="button"
        onClick={() => setPinned(true)}
        className="fixed bottom-3 right-3 z-30 flex items-center gap-1 rounded-full border border-border/60 bg-card/80 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground shadow"
        aria-label="Pin channel values"
        title="Show live channel values"
      >
        <Pin className="h-3 w-3" /> Live values
      </button>
    );
  }

  // Find the sample nearest to the current cursor
  const cells: { channel: string; value: number | null; stats: { min: number; max: number; avg: number } | null }[] = [];
  if (data && data.rowCount > 0) {
    const tc = data.timecodes;
    let idx = 0;
    if (cursorMs != null) {
      // Cursor is in lap-relative ms; timecodes in the resampled table are
      // absolute ms from session start. Lap start is the first row.
      const target = tc[0] + cursorMs;
      let lo = 0;
      let hi = tc.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tc[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      idx = lo;
    }
    for (const ch of channels) {
      const arr = data.channels[ch];
      if (!arr || arr.length === 0) {
        cells.push({ channel: ch, value: null, stats: null });
        continue;
      }
      const value = arr[Math.min(idx, arr.length - 1)];
      // Cheap stats on the full lap.
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      cells.push({
        channel: ch,
        value,
        stats:
          Number.isFinite(min) && arr.length > 0
            ? { min, max, avg: sum / arr.length }
            : null,
      });
    }
  }

  return (
    <div className="fixed bottom-3 right-3 z-30 max-w-[320px] rounded-lg border border-border/60 bg-card/90 backdrop-blur p-2 shadow text-[11px]">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-foreground">
          Live values · {lapNum ? `L${lapNum}` : "—"}
        </span>
        <button
          type="button"
          onClick={() => setPinned(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Unpin"
        >
          <PinOff className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 gap-y-0.5 tabular-nums">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">ch</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground text-right">now</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground text-right">min</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground text-right">max</div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground text-right">avg</div>
        {cells.map((c) => (
          <FragmentLike key={c.channel}>
            <div className="text-muted-foreground truncate max-w-[100px]">{c.channel}</div>
            <div className="font-mono text-foreground text-right">
              {c.value != null && Number.isFinite(c.value) ? c.value.toFixed(1) : "—"}
            </div>
            <div className="font-mono text-muted-foreground/70 text-right">
              {c.stats ? c.stats.min.toFixed(1) : "—"}
            </div>
            <div className="font-mono text-muted-foreground/70 text-right">
              {c.stats ? c.stats.max.toFixed(1) : "—"}
            </div>
            <div className="font-mono text-muted-foreground/70 text-right">
              {c.stats ? c.stats.avg.toFixed(1) : "—"}
            </div>
          </FragmentLike>
        ))}
      </div>
    </div>
  );
}

// Small helper to let us emit >1 sibling inside a grid map without creating
// a wrapper div (which would break the grid).
function FragmentLike({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
