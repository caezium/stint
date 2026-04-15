import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SpeedUnit = "ms" | "kmh" | "mph";
export type TemperatureUnit = "c" | "f" | "k";
export type DistanceUnit = "m" | "km" | "mi" | "ft";
export type AngularUnit = "deg" | "rad";
export type Colormap = "viridis" | "magma" | "rainbow" | "blue-red";

interface UnitsStore {
  speedUnit: SpeedUnit;
  temperatureUnit: TemperatureUnit;
  distanceUnit: DistanceUnit;
  angularUnit: AngularUnit;
  colormap: Colormap;
  setSpeedUnit: (u: SpeedUnit) => void;
  setTemperatureUnit: (u: TemperatureUnit) => void;
  setDistanceUnit: (u: DistanceUnit) => void;
  setAngularUnit: (u: AngularUnit) => void;
  setColormap: (c: Colormap) => void;
}

export const useUnitsStore = create<UnitsStore>()(
  persist(
    (set) => ({
      speedUnit: "kmh",
      temperatureUnit: "c",
      distanceUnit: "m",
      angularUnit: "deg",
      colormap: "viridis",
      setSpeedUnit: (u) => set({ speedUnit: u }),
      setTemperatureUnit: (u) => set({ temperatureUnit: u }),
      setDistanceUnit: (u) => set({ distanceUnit: u }),
      setAngularUnit: (u) => set({ angularUnit: u }),
      setColormap: (c) => set({ colormap: c }),
    }),
    { name: "stint-units" }
  )
);

// ---------- Speed ----------
export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = {
  ms: "m/s",
  kmh: "km/h",
  mph: "mph",
};

const MS_TO_SPEED: Record<SpeedUnit, number> = {
  ms: 1,
  kmh: 3.6,
  mph: 2.23693629,
};

function speedBaseToMs(units: string): number | null {
  const u = units.trim().toLowerCase();
  if (u === "m/s" || u === "mps") return 1;
  if (u === "km/h" || u === "kmh" || u === "kph") return 1 / 3.6;
  if (u === "mph") return 0.44704;
  return null;
}

export function isSpeedUnits(units: string): boolean {
  return speedBaseToMs(units) != null;
}

export function convertSpeed(value: number, fromUnits: string, toUnit: SpeedUnit): number {
  const toMs = speedBaseToMs(fromUnits);
  if (toMs == null) return value;
  return value * toMs * MS_TO_SPEED[toUnit];
}

// ---------- Temperature ----------
export const TEMP_UNIT_LABEL: Record<TemperatureUnit, string> = {
  c: "°C",
  f: "°F",
  k: "K",
};

export function isTemperatureUnits(units: string): boolean {
  const u = units.trim().toLowerCase().replace(/°/g, "");
  return u === "c" || u === "f" || u === "k";
}

export function convertTemperature(
  value: number,
  fromUnits: string,
  toUnit: TemperatureUnit
): number {
  const u = fromUnits.trim().toLowerCase().replace(/°/g, "");
  let celsius: number;
  if (u === "c") celsius = value;
  else if (u === "f") celsius = (value - 32) * (5 / 9);
  else if (u === "k") celsius = value - 273.15;
  else return value;
  if (toUnit === "c") return celsius;
  if (toUnit === "f") return celsius * (9 / 5) + 32;
  return celsius + 273.15;
}

// ---------- Distance ----------
export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, string> = {
  m: "m",
  km: "km",
  mi: "mi",
  ft: "ft",
};

const M_TO_DIST: Record<DistanceUnit, number> = {
  m: 1,
  km: 1 / 1000,
  mi: 1 / 1609.344,
  ft: 3.28084,
};

function distBaseToM(units: string): number | null {
  const u = units.trim().toLowerCase();
  if (u === "m" || u === "meter" || u === "meters") return 1;
  if (u === "km") return 1000;
  if (u === "mi" || u === "mile" || u === "miles") return 1609.344;
  if (u === "ft" || u === "feet") return 0.3048;
  return null;
}

export function isDistanceUnits(units: string): boolean {
  return distBaseToM(units) != null;
}

export function convertDistance(value: number, fromUnits: string, toUnit: DistanceUnit): number {
  const toM = distBaseToM(fromUnits);
  if (toM == null) return value;
  return value * toM * M_TO_DIST[toUnit];
}

// ---------- Angular ----------
export const ANGULAR_UNIT_LABEL: Record<AngularUnit, string> = {
  deg: "°",
  rad: "rad",
};

export function isAngularUnits(units: string): boolean {
  const u = units.trim().toLowerCase();
  return u === "deg" || u === "°" || u === "rad";
}

export function convertAngular(value: number, fromUnits: string, toUnit: AngularUnit): number {
  const u = fromUnits.trim().toLowerCase();
  const inDeg = u === "deg" || u === "°";
  const inRad = u === "rad";
  if (!inDeg && !inRad) return value;
  if (inDeg && toUnit === "deg") return value;
  if (inRad && toUnit === "rad") return value;
  if (inDeg && toUnit === "rad") return value * (Math.PI / 180);
  return value * (180 / Math.PI);
}

// ---------- Colormap ramps ----------
type Ramp = [number, number, number][];

const VIRIDIS: Ramp = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

const MAGMA: Ramp = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191],
];

const RAINBOW: Ramp = [
  [75, 0, 130],
  [0, 0, 255],
  [0, 255, 255],
  [0, 255, 0],
  [255, 255, 0],
  [255, 128, 0],
  [255, 0, 0],
];

const BLUE_RED: Ramp = [
  [59, 130, 246],
  [170, 170, 170],
  [239, 68, 68],
];

export const COLORMAP_RAMPS: Record<Colormap, Ramp> = {
  viridis: VIRIDIS,
  magma: MAGMA,
  rainbow: RAINBOW,
  "blue-red": BLUE_RED,
};

export const COLORMAP_LABEL: Record<Colormap, string> = {
  viridis: "Viridis",
  magma: "Magma",
  rainbow: "Rainbow",
  "blue-red": "Blue-Red",
};

export function sampleRamp(ramp: Ramp, t: number): string {
  const f = Math.max(0, Math.min(1, t));
  const segs = ramp.length - 1;
  const pos = f * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const u = pos - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgb(${r},${g},${bl})`;
}

export function rampToCssGradient(ramp: Ramp): string {
  const stops = ramp
    .map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${((i / (ramp.length - 1)) * 100).toFixed(1)}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}
