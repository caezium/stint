import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SpeedUnit = "ms" | "kmh" | "mph";

interface UnitsStore {
  speedUnit: SpeedUnit;
  setSpeedUnit: (u: SpeedUnit) => void;
}

export const useUnitsStore = create<UnitsStore>()(
  persist(
    (set) => ({
      speedUnit: "kmh",
      setSpeedUnit: (u) => set({ speedUnit: u }),
    }),
    { name: "kartlab-units" }
  )
);

export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = {
  ms: "m/s",
  kmh: "km/h",
  mph: "mph",
};

const MS_TO: Record<SpeedUnit, number> = {
  ms: 1,
  kmh: 3.6,
  mph: 2.23693629,
};

/** Normalize a channel's native units string to m/s factor, or null if not a speed. */
function baseToMs(units: string): number | null {
  const u = units.trim().toLowerCase();
  if (u === "m/s" || u === "mps") return 1;
  if (u === "km/h" || u === "kmh" || u === "kph") return 1 / 3.6;
  if (u === "mph") return 0.44704;
  return null;
}

export function isSpeedUnits(units: string): boolean {
  return baseToMs(units) != null;
}

export function convertSpeed(
  value: number,
  fromUnits: string,
  toUnit: SpeedUnit
): number {
  const toMs = baseToMs(fromUnits);
  if (toMs == null) return value;
  return value * toMs * MS_TO[toUnit];
}
