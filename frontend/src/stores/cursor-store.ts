import { create } from "zustand";
import { persist } from "zustand/middleware";

export type XAxisMode = "time" | "distance";
export type CursorSize = "none" | "small" | "large";

interface ZoomRange {
  min: number;
  max: number;
}

interface CursorStore {
  /** Current cursor position in ms (lap-relative) */
  cursorMs: number | null;
  setCursorMs: (ms: number | null) => void;

  /** Synced zoom range across all charts (in x-axis units: seconds or meters) */
  zoomRange: ZoomRange | null;
  setZoomRange: (range: ZoomRange | null) => void;

  /** Toggle between time and distance x-axis */
  xAxisMode: XAxisMode;
  setXAxisMode: (mode: XAxisMode) => void;

  /** Phase 16.1: snap zoom-out to lap boundary */
  snapMode: boolean;
  setSnapMode: (v: boolean) => void;

  /** Phase 16.2: sync cursor across overlay laps by lap-relative time */
  localTimeMode: boolean;
  setLocalTimeMode: (v: boolean) => void;

  /** Phase 16.4: cursor dot size on track map + crosshair style on charts */
  cursorSize: CursorSize;
  setCursorSize: (s: CursorSize) => void;
}

export const useCursorStore = create<CursorStore>()(
  persist(
    (set) => ({
      cursorMs: null,
      setCursorMs: (ms) => set({ cursorMs: ms }),

      zoomRange: null,
      setZoomRange: (range) => set({ zoomRange: range }),

      xAxisMode: "time",
      setXAxisMode: (mode) => set({ xAxisMode: mode }),

      snapMode: true,
      setSnapMode: (v) => set({ snapMode: v }),

      localTimeMode: false,
      setLocalTimeMode: (v) => set({ localTimeMode: v }),

      cursorSize: "small",
      setCursorSize: (s) => set({ cursorSize: s }),
    }),
    {
      name: "stint-cursor-prefs",
      // Only persist the user preferences; leave cursorMs + zoomRange
      // per-session so they reset between sessions.
      partialize: (state) => ({
        snapMode: state.snapMode,
        localTimeMode: state.localTimeMode,
        cursorSize: state.cursorSize,
        xAxisMode: state.xAxisMode,
      }),
    }
  )
);
