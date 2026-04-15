export const LAP_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
];

export const CHANNEL_CATEGORIES: Record<string, string[]> = {
  Speed: ["Speed", "GPS_Speed", "Ground Speed"],
  Engine: ["RPM", "Engine", "Throttle", "TPS"],
  Temperature: ["Temp", "Temperature", "Water", "Oil", "EGT", "CHT"],
  Acceleration: ["Accel", "G_Force", "Lateral", "Longitudinal"],
  Position: ["GPS", "Lat", "Lon", "Altitude"],
  Steering: ["Steering", "Steer"],
  Brakes: ["Brake"],
  Lap: ["Lap", "Beacon"],
  Math: [],
  "Math (Default)": ["DriverIntent", "CombinedG", "LateralLoadTransfer", "TractivePower"],
  Other: [],
};

export const DEFAULT_MATH_CHANNELS = [
  { name: "DriverIntent", units: "state" },
  { name: "CombinedG", units: "g" },
  { name: "LateralLoadTransfer", units: "indicator" },
  { name: "TractivePower", units: "kW" },
];

export function formatLapTime(ms: number): string {
  if (ms <= 0 || !isFinite(ms)) return "--:--.---";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}
