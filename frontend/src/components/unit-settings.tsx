"use client";

import { useState, useRef, useEffect } from "react";
import {
  useUnitsStore,
  SPEED_UNIT_LABEL,
  TEMP_UNIT_LABEL,
  DISTANCE_UNIT_LABEL,
  ANGULAR_UNIT_LABEL,
  COLORMAP_LABEL,
  COLORMAP_RAMPS,
  rampToCssGradient,
  type SpeedUnit,
  type TemperatureUnit,
  type DistanceUnit,
  type AngularUnit,
  type Colormap,
} from "@/stores/units-store";

export function UnitSettings() {
  const s = useUnitsStore();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-muted hover:bg-muted/80 rounded px-2 py-0.5 text-xs text-foreground"
        title="Units & display settings"
      >
        Units
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-md border border-border bg-background shadow-lg p-2 text-xs space-y-1.5">
          <Row label="Speed">
            <Select
              value={s.speedUnit}
              onChange={(v) => s.setSpeedUnit(v as SpeedUnit)}
              options={SPEED_UNIT_LABEL}
            />
          </Row>
          <Row label="Temp">
            <Select
              value={s.temperatureUnit}
              onChange={(v) => s.setTemperatureUnit(v as TemperatureUnit)}
              options={TEMP_UNIT_LABEL}
            />
          </Row>
          <Row label="Distance">
            <Select
              value={s.distanceUnit}
              onChange={(v) => s.setDistanceUnit(v as DistanceUnit)}
              options={DISTANCE_UNIT_LABEL}
            />
          </Row>
          <Row label="Angular">
            <Select
              value={s.angularUnit}
              onChange={(v) => s.setAngularUnit(v as AngularUnit)}
              options={ANGULAR_UNIT_LABEL}
            />
          </Row>
          <Row label="Colormap">
            <Select
              value={s.colormap}
              onChange={(v) => s.setColormap(v as Colormap)}
              options={COLORMAP_LABEL}
            />
          </Row>
          <div
            className="h-2 rounded-sm mt-1"
            style={{ background: rampToCssGradient(COLORMAP_RAMPS[s.colormap]) }}
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-muted border-none rounded px-1.5 py-0.5 text-xs text-foreground"
    >
      {Object.keys(options).map((k) => (
        <option key={k} value={k}>
          {options[k]}
        </option>
      ))}
    </select>
  );
}
