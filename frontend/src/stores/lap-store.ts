import { create } from "zustand";
import type { Lap } from "@/lib/api";

export interface CrossSessionLap {
  sessionId: string;
  sessionLabel: string;
  lap: Lap;
}

interface LapStore {
  refLap: Lap | null;
  altLap: Lap | null;
  extraLaps: Lap[];
  /** Laps pinned from OTHER sessions for cross-session comparison. */
  crossSessionLaps: CrossSessionLap[];
  setRefLap: (lap: Lap) => void;
  setAltLap: (lap: Lap | null) => void;
  toggleExtraLap: (lap: Lap) => void;
  addCrossSessionLap: (entry: CrossSessionLap) => void;
  removeCrossSessionLap: (sessionId: string, lapNum: number) => void;
  autoSelectBest: (laps: Lap[]) => void;
  reset: () => void;
}

export const useLapStore = create<LapStore>((set) => ({
  refLap: null,
  altLap: null,
  extraLaps: [],
  crossSessionLaps: [],
  setRefLap: (lap) => set({ refLap: lap }),
  setAltLap: (lap) => set({ altLap: lap }),
  toggleExtraLap: (lap) =>
    set((state) => {
      const exists = state.extraLaps.some((l) => l.num === lap.num);
      return {
        extraLaps: exists
          ? state.extraLaps.filter((l) => l.num !== lap.num)
          : [...state.extraLaps, lap],
      };
    }),
  addCrossSessionLap: (entry) =>
    set((state) => {
      const exists = state.crossSessionLaps.some(
        (e) => e.sessionId === entry.sessionId && e.lap.num === entry.lap.num
      );
      if (exists) return state;
      return { crossSessionLaps: [...state.crossSessionLaps, entry] };
    }),
  removeCrossSessionLap: (sessionId, lapNum) =>
    set((state) => ({
      crossSessionLaps: state.crossSessionLaps.filter(
        (e) => !(e.sessionId === sessionId && e.lap.num === lapNum)
      ),
    })),
  autoSelectBest: (laps) => {
    const valid = laps.filter((l) => l.num > 0 && l.duration_ms > 0);
    if (valid.length === 0) return;
    const best = valid.reduce((a, b) =>
      a.duration_ms < b.duration_ms ? a : b
    );
    set({ refLap: best, altLap: null, extraLaps: [] });
  },
  reset: () =>
    set({ refLap: null, altLap: null, extraLaps: [], crossSessionLaps: [] }),
}));
