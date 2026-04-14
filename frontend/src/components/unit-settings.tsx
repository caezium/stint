"use client";

import { useUnitsStore, SPEED_UNIT_LABEL, type SpeedUnit } from "@/stores/units-store";

export function UnitSettings() {
  const speedUnit = useUnitsStore((s) => s.speedUnit);
  const setSpeedUnit = useUnitsStore((s) => s.setSpeedUnit);

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">Speed:</span>
      <select
        value={speedUnit}
        onChange={(e) => setSpeedUnit(e.target.value as SpeedUnit)}
        className="bg-muted border-none rounded px-1.5 py-0.5 text-xs text-foreground"
      >
        {(Object.keys(SPEED_UNIT_LABEL) as SpeedUnit[]).map((u) => (
          <option key={u} value={u}>
            {SPEED_UNIT_LABEL[u]}
          </option>
        ))}
      </select>
    </div>
  );
}
