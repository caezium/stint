"use client";

import { useEffect, useRef, useCallback, useState, useMemo, lazy, Suspense } from "react";
import { useCursorStore } from "@/stores/cursor-store";
import {
  useUnitsStore,
  COLORMAP_RAMPS,
  sampleRamp,
  rampToCssGradient,
} from "@/stores/units-store";

export type MapViewMode = "canvas" | "satellite" | "street";

export interface LapTrace {
  lapNum: number;
  lat: number[];
  lon: number[];
  /** Lap-relative timecodes in ms (aligned with lat/lon) */
  timecodes?: number[];
  /** Optional per-point values for gradient coloring (e.g. speed). Only used when single lap. */
  values?: number[];
  /** Display color for this lap when >1 laps are shown */
  color: string;
  label?: string;
}

interface TrackMapProps {
  /** Multi-lap traces. If empty, falls back to legacy single-lap props. */
  laps?: LapTrace[];
  /** Legacy single-lap props (used when `laps` not provided) */
  lat?: number[];
  lon?: number[];
  speed?: number[];
  timecodes?: number[];
  /** Label for the value gradient (used by legend when single-lap) */
  valueLabel?: string;
  valueUnits?: string;
  /** Fixed sizing (optional). If omitted the canvas fills its container. */
  width?: number;
  height?: number;
  interactive?: boolean;
  sfLine?: { lat1: number; lon1: number; lat2: number; lon2: number } | null;
  splitLines?: { lat1: number; lon1: number; lat2: number; lon2: number }[];
  /** GPS lat/lon offset for calibration (degrees) */
  gpsOffset?: { lat: number; lon: number };
  /** Called when user changes the GPS offset */
  onGpsOffsetChange?: (offset: { lat: number; lon: number }) => void;
}

interface CoordTransform {
  correctedLon: number[][]; // per-lap
  minLat: number;
  maxLat: number;
  minLon: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function buildTransform(
  latsPerLap: number[][],
  lonsPerLap: number[][],
  width: number,
  height: number,
  padding = 24
): CoordTransform {
  // Mean lat across all laps for longitude correction
  let sumLat = 0;
  let n = 0;
  for (const lats of latsPerLap) {
    for (const v of lats) {
      sumLat += v;
      n++;
    }
  }
  const meanLat = n > 0 ? sumLat / n : 0;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);

  const correctedLon = lonsPerLap.map((lons) => lons.map((l) => l * cosLat));

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const lats of latsPerLap) {
    for (const v of lats) {
      if (v < minLat) minLat = v;
      if (v > maxLat) maxLat = v;
    }
  }
  for (const lons of correctedLon) {
    for (const v of lons) {
      if (v < minLon) minLon = v;
      if (v > maxLon) maxLon = v;
    }
  }

  const rangeLat = (maxLat - minLat) || 0.001;
  const rangeLon = (maxLon - minLon) || 0.001;
  const drawW = width - padding * 2;
  const drawH = height - padding * 2;
  const scale = Math.min(drawW / rangeLon, drawH / rangeLat);
  const offsetX = padding + (drawW - rangeLon * scale) / 2;
  const offsetY = padding + (drawH - rangeLat * scale) / 2;

  return { correctedLon, minLat, maxLat, minLon, scale, offsetX, offsetY };
}

// Diverging: blue → grey → red (fixed; signed data)
const DIVERGING_RAMP: [number, number, number][] = [
  [59, 130, 246],
  [170, 170, 170],
  [239, 68, 68],
];
function divergingColor(n: number): string {
  // n in [-1,1] → [0,1]
  return sampleRamp(DIVERGING_RAMP, (Math.max(-1, Math.min(1, n)) + 1) / 2);
}

function findNearestIndex(timecodes: number[], targetMs: number): number {
  let lo = 0;
  let hi = timecodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timecodes[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const dLo = Math.abs(timecodes[lo] - targetMs);
    const dPrev = Math.abs(timecodes[lo - 1] - targetMs);
    if (dPrev < dLo) return lo - 1;
  }
  return lo;
}

export function TrackMap({
  laps,
  lat,
  lon,
  speed,
  timecodes,
  valueLabel = "Speed",
  valueUnits = "",
  width,
  height,
  interactive = false,
  sfLine = null,
  splitLines = [],
  gpsOffset,
  onGpsOffsetChange,
}: TrackMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<CoordTransform | null>(null);
  const cursorMs = useCursorStore((s) => s.cursorMs);
  const setCursorMs = useCursorStore((s) => s.setCursorMs);
  const colormap = useUnitsStore((s) => s.colormap);
  const sequentialRamp = COLORMAP_RAMPS[colormap];

  const [mapMode, setMapMode] = useState<MapViewMode>("canvas");
  const [showOffsetControls, setShowOffsetControls] = useState(false);
  const [localOffset, setLocalOffset] = useState<{ lat: number; lon: number }>(
    gpsOffset ?? { lat: 0, lon: 0 }
  );

  // Sync incoming offset prop
  useEffect(() => {
    if (gpsOffset) setLocalOffset(gpsOffset);
  }, [gpsOffset]);

  const [box, setBox] = useState<{ w: number; h: number }>({
    w: width ?? 300,
    h: height ?? 240,
  });

  // Normalize inputs into a laps array, applying GPS offset
  const oLat = localOffset.lat;
  const oLon = localOffset.lon;
  const traces: LapTrace[] = useMemo(() => {
    const raw: LapTrace[] =
      laps && laps.length > 0
        ? laps
        : lat && lon && lat.length > 1
          ? [
              {
                lapNum: 0,
                lat,
                lon,
                timecodes,
                values: speed,
                color: "#ef4444",
              },
            ]
          : [];
    if (oLat === 0 && oLon === 0) return raw;
    return raw.map((tr) => ({
      ...tr,
      lat: tr.lat.map((v) => v + oLat),
      lon: tr.lon.map((v) => v + oLon),
    }));
  }, [laps, lat, lon, timecodes, speed, oLat, oLon]);

  // ResizeObserver for responsive canvas
  useEffect(() => {
    if (width != null && height != null) return; // fixed size
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const drawWidth = width ?? box.w;
  const drawHeight = height ?? box.h;

  // Determine if we should use value gradient: only when a single trace with values
  const singleWithValues =
    traces.length === 1 && !!traces[0].values && traces[0].values!.length === traces[0].lat.length;

  const drawTrack = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || traces.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(drawWidth * dpr));
    canvas.height = Math.max(1, Math.floor(drawHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, drawWidth, drawHeight);

    const t = buildTransform(
      traces.map((tr) => tr.lat),
      traces.map((tr) => tr.lon),
      drawWidth,
      drawHeight
    );
    transformRef.current = t;

    const toX = (corrLon: number) => t.offsetX + (corrLon - t.minLon) * t.scale;
    const toY = (latVal: number) => t.offsetY + (t.maxLat - latVal) * t.scale;

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Value gradient for single trace
    if (singleWithValues) {
      const tr = traces[0];
      const vals = tr.values!;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const v of vals) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const signed = minV < 0 && maxV > 0;
      const bound = signed ? Math.max(Math.abs(minV), Math.abs(maxV)) || 1 : 1;
      const range = maxV - minV || 1;
      const cLon = t.correctedLon[0];
      ctx.lineWidth = 2.5;
      for (let i = 0; i < tr.lat.length - 1; i++) {
        let color: string;
        if (signed) {
          // Diverging: -bound → blue, 0 → grey, +bound → red
          const n = Math.max(-1, Math.min(1, vals[i] / bound));
          color = divergingColor(n);
        } else {
          // Sequential from selected colormap
          const f = (vals[i] - minV) / range;
          color = sampleRamp(sequentialRamp, f);
        }
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(toX(cLon[i]), toY(tr.lat[i]));
        ctx.lineTo(toX(cLon[i + 1]), toY(tr.lat[i + 1]));
        ctx.stroke();
      }
    } else {
      // Multi-lap: each lap a solid line in its own color
      for (let li = 0; li < traces.length; li++) {
        const tr = traces[li];
        const cLon = t.correctedLon[li];
        ctx.strokeStyle = tr.color;
        ctx.globalAlpha = li === 0 ? 1 : 0.7;
        ctx.beginPath();
        ctx.moveTo(toX(cLon[0]), toY(tr.lat[0]));
        for (let i = 1; i < tr.lat.length; i++) {
          ctx.lineTo(toX(cLon[i]), toY(tr.lat[i]));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // S/F line overlay
    if (sfLine) {
      const meanLat = (t.minLat + t.maxLat) / 2;
      const cosLat = Math.cos((meanLat * Math.PI) / 180);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(toX(sfLine.lon1 * cosLat), toY(sfLine.lat1));
      ctx.lineTo(toX(sfLine.lon2 * cosLat), toY(sfLine.lat2));
      ctx.stroke();
    }
    // Split lines
    if (splitLines && splitLines.length > 0) {
      const meanLat = (t.minLat + t.maxLat) / 2;
      const cosLat = Math.cos((meanLat * Math.PI) / 180);
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      for (const s of splitLines) {
        ctx.beginPath();
        ctx.moveTo(toX(s.lon1 * cosLat), toY(s.lat1));
        ctx.lineTo(toX(s.lon2 * cosLat), toY(s.lat2));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Start marker (from first lap)
    if (traces[0].lat.length > 0) {
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(
        toX(t.correctedLon[0][0]),
        toY(traces[0].lat[0]),
        4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Cursor dot(s) — one per lap
    if (interactive && cursorMs != null) {
      for (let li = 0; li < traces.length; li++) {
        const tr = traces[li];
        if (!tr.timecodes || tr.timecodes.length !== tr.lat.length) continue;
        const idx = findNearestIndex(tr.timecodes, cursorMs);
        if (idx < 0 || idx >= tr.lat.length) continue;
        const cx = toX(t.correctedLon[li][idx]);
        const cy = toY(tr.lat[idx]);
        // Glow
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        // Dot in lap color (or white if single speed-gradient)
        ctx.fillStyle = singleWithValues ? "#ffffff" : tr.color;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    }
  }, [traces, drawWidth, drawHeight, interactive, cursorMs, singleWithValues, sequentialRamp, sfLine, splitLines]);

  useEffect(() => {
    drawTrack();
  }, [drawTrack]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      const canvas = canvasRef.current;
      const t = transformRef.current;
      if (!canvas || !t) return;

      // Use first lap with timecodes as click target
      const target = traces.find(
        (tr) => tr.timecodes && tr.timecodes.length === tr.lat.length
      );
      if (!target) return;
      const targetIdx = traces.indexOf(target);

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const cLon = t.correctedLon[targetIdx];
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < target.lat.length; i++) {
        const px = t.offsetX + (cLon[i] - t.minLon) * t.scale;
        const py = t.offsetY + (t.maxLat - target.lat[i]) * t.scale;
        const d = (px - clickX) ** 2 + (py - clickY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestDist < 400) {
        setCursorMs(target.timecodes![bestIdx]);
      }
    },
    [interactive, traces, setCursorMs]
  );

  // GPS offset nudge helpers
  const NUDGE_STEP = 0.00003; // ~3 meters
  const nudge = (axis: "lat" | "lon", dir: 1 | -1) => {
    const next = { ...localOffset, [axis]: localOffset[axis] + dir * NUDGE_STEP };
    setLocalOffset(next);
    onGpsOffsetChange?.(next);
  };
  const resetOffset = () => {
    const zero = { lat: 0, lon: 0 };
    setLocalOffset(zero);
    onGpsOffsetChange?.(zero);
  };

  if (traces.length === 0) {
    return (
      <div
        ref={wrapperRef}
        className="flex items-center justify-center rounded-lg bg-[#0c0c0c] text-muted-foreground text-sm w-full h-full"
        style={width != null && height != null ? { width, height } : undefined}
      >
        No GPS data available
      </div>
    );
  }

  // Compute min/max for single-value legend
  let legendMin: number | null = null;
  let legendMax: number | null = null;
  if (singleWithValues && traces[0].values) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of traces[0].values) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    legendMin = mn;
    legendMax = mx;
  }

  // Mode toggle buttons (top-right corner)
  const modeToggle = (
    <div className="absolute top-1 right-1 z-[500] flex gap-0.5 bg-black/60 rounded text-[9px]">
      {(["canvas", "satellite", "street"] as MapViewMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setMapMode(m)}
          className={`px-1.5 py-0.5 rounded transition-colors capitalize ${
            mapMode === m
              ? "bg-white/20 text-white"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          {m === "canvas" ? "Plain" : m === "satellite" ? "Sat" : "Map"}
        </button>
      ))}
      <button
        onClick={() => setShowOffsetControls((v) => !v)}
        className={`px-1.5 py-0.5 rounded transition-colors ${
          showOffsetControls ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"
        }`}
        title="GPS offset calibration"
      >
        ⊕
      </button>
    </div>
  );

  // GPS offset controls
  const offsetControls = showOffsetControls && (
    <div className="absolute top-7 right-1 z-[500] bg-black/70 rounded p-1.5 text-[9px] text-white/80 flex flex-col items-center gap-1">
      <span className="text-white/50 text-[8px]">GPS Offset</span>
      <button onClick={() => nudge("lat", 1)} className="hover:text-white px-1">▲ N</button>
      <div className="flex items-center gap-1">
        <button onClick={() => nudge("lon", -1)} className="hover:text-white px-1">◀ W</button>
        <button onClick={resetOffset} className="hover:text-white px-1 text-red-400" title="Reset offset">✕</button>
        <button onClick={() => nudge("lon", 1)} className="hover:text-white px-1">E ▶</button>
      </div>
      <button onClick={() => nudge("lat", -1)} className="hover:text-white px-1">▼ S</button>
      <span className="text-[7px] text-white/40 mt-0.5">
        {localOffset.lat !== 0 || localOffset.lon !== 0
          ? `Δ ${(localOffset.lat * 111111).toFixed(1)}m N, ${(localOffset.lon * 111111 * Math.cos((traces[0].lat[0] * Math.PI) / 180)).toFixed(1)}m E`
          : "No offset"}
      </span>
    </div>
  );

  // Shared value-gradient legend (single-trace with values)
  const valueLegend =
    singleWithValues && legendMin != null && legendMax != null
      ? (() => {
          const signed = legendMin < 0 && legendMax > 0;
          const bound = Math.max(Math.abs(legendMin), Math.abs(legendMax));
          const lo = signed ? -bound : legendMin;
          const hi = signed ? bound : legendMax;
          const fmt = (v: number) =>
            valueUnits === "m" ? Math.round(v).toString() : v.toFixed(1);
          const gradient = signed
            ? rampToCssGradient(DIVERGING_RAMP)
            : rampToCssGradient(sequentialRamp);
          return (
            <div className="absolute bottom-1 left-1 right-1 z-[500] flex items-center gap-1.5 text-[10px] text-white/90 bg-black/50 rounded px-1.5 py-0.5">
              <span>{fmt(lo)}{valueUnits}</span>
              <div className="relative flex-1 h-1.5 rounded-sm" style={{ background: gradient }}>
                {signed && (
                  <div className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-white/60" />
                )}
              </div>
              <span>{fmt(hi)}{valueUnits}</span>
              <span className="ml-1 opacity-60">{valueLabel}</span>
            </div>
          );
        })()
      : null;

  // Leaflet tile-based view
  if (mapMode !== "canvas") {
    return (
      <div
        ref={wrapperRef}
        className="relative rounded-lg overflow-hidden w-full h-full"
        style={width != null && height != null ? { width, height } : undefined}
      >
        <Suspense fallback={<div className="w-full h-full bg-[#0c0c0c]" />}>
          <AnalysisLeafletMap
            traces={traces}
            cursorMs={cursorMs}
            setCursorMs={interactive ? setCursorMs : undefined}
            sfLine={sfLine}
            splitLines={splitLines}
            tileMode={mapMode}
            width="100%"
            height="100%"
          />
        </Suspense>
        {modeToggle}
        {offsetControls}
        {valueLegend}
        {!singleWithValues && traces.length > 0 && (
          <div className="absolute bottom-1 left-1 z-[500] flex flex-wrap gap-1.5 text-[10px] bg-black/40 rounded px-1.5 py-0.5">
            {traces.map((tr) => (
              <div key={tr.lapNum} className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: tr.color }} />
                <span className="text-white/80">{tr.label ?? `L${tr.lapNum}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Canvas-based view (original)
  return (
    <div
      ref={wrapperRef}
      className="relative rounded-lg overflow-hidden w-full h-full"
      style={width != null && height != null ? { width, height } : undefined}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: drawWidth,
          height: drawHeight,
          cursor: interactive ? "crosshair" : "default",
          display: "block",
        }}
        onClick={handleClick}
      />

      {modeToggle}
      {offsetControls}

      {/* Legend */}
      {singleWithValues && legendMin != null && legendMax != null && (() => {
        const signed = legendMin < 0 && legendMax > 0;
        const bound = Math.max(Math.abs(legendMin), Math.abs(legendMax));
        const lo = signed ? -bound : legendMin;
        const hi = signed ? bound : legendMax;
        const fmt = (v: number) =>
          valueUnits === "m" ? Math.round(v).toString() : v.toFixed(1);
        const gradient = signed
          ? rampToCssGradient(DIVERGING_RAMP)
          : rampToCssGradient(sequentialRamp);
        return (
          <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1.5 text-[10px] text-white/70 bg-black/40 rounded px-1.5 py-0.5">
            <span>{fmt(lo)}{valueUnits}</span>
            <div className="relative flex-1 h-1.5 rounded-sm" style={{ background: gradient }}>
              {signed && (
                <div className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-white/60" />
              )}
            </div>
            <span>{fmt(hi)}{valueUnits}</span>
            <span className="ml-1 opacity-60">{valueLabel}</span>
          </div>
        );
      })()}

      {!singleWithValues && traces.length > 0 && (
        <div className="absolute bottom-1 left-1 flex flex-wrap gap-1.5 text-[10px] bg-black/40 rounded px-1.5 py-0.5">
          {traces.map((tr) => (
            <div key={tr.lapNum} className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: tr.color }}
              />
              <span className="text-white/80">
                {tr.label ?? `L${tr.lapNum}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Leaflet-based analysis map (lazy loaded) ───────────────────────────

const AnalysisLeafletMap = lazy(() => import("./track-map-analysis-leaflet"));
