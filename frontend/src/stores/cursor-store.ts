import { create } from "zustand";

export type XAxisMode = "time" | "distance";

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
}

export const useCursorStore = create<CursorStore>((set) => ({
  cursorMs: null,
  setCursorMs: (ms) => set({ cursorMs: ms }),

  zoomRange: null,
  setZoomRange: (range) => set({ zoomRange: range }),

  xAxisMode: "time",
  setXAxisMode: (mode) => set({ xAxisMode: mode }),
}));
