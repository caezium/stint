"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useLapStore } from "@/stores/lap-store";
import { useCursorStore } from "@/stores/cursor-store";
import { useSessionStore } from "@/stores/session-store";
import {
  useUnitsStore,
  isSpeedUnits,
  convertSpeed,
  SPEED_UNIT_LABEL,
  isTemperatureUnits,
  convertTemperature,
  TEMP_UNIT_LABEL,
  isDistanceUnits,
  convertDistance,
  DISTANCE_UNIT_LABEL,
  isAngularUnits,
  convertAngular,
  ANGULAR_UNIT_LABEL,
} from "@/stores/units-store";
import { fetchResampledData, fetchDistance, type ResampledData, type DistanceData } from "@/lib/api";
import type uPlot from "uplot";
import type { Lap } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import {
  ChartContextMenu,
  type ChartContextMenuState,
} from "@/components/chart-context-menu";

/** Phase 26 follow-up: shaded band drawn under the series for each
 * detected corner. `startSec` / `endSec` are seconds from the rep lap
 * start, `startM` / `endM` are cumulative metres of the rep lap; the
 * chart picks whichever matches its current x-axis mode.
 */
export interface ChartCornerBand {
  num: number;
  label?: string | null;
  direction: "left" | "right";
  startSec: number;
  endSec: number;
  startM: number;
  endM: number;
}

interface TelemetryChartProps {
  channels: string[];
  sessionId: string;
  height?: number;
  corners?: ChartCornerBand[];
}

/** Shared cursor sync key for all telemetry charts */
const SYNC_KEY = "telemetry";

const LAP_COLORS = [
  "#ef4444", // red (ref)
  "#3b82f6", // blue (alt)
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#eab308", // yellow
  "#ec4899", // pink
];

interface LapData {
  lap: Lap;
  data: ResampledData;
  colorOffset: number;
}

export function TelemetryChart({
  channels,
  sessionId,
  height = 260,
  corners,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const uPlotModule = useRef<typeof uPlot | null>(null);

  const { refLap, altLap, extraLaps, crossSessionLaps } = useLapStore();
  const sessionChannels = useSessionStore((s) => s.session?.channels);
  const speedUnit = useUnitsStore((s) => s.speedUnit);
  const temperatureUnit = useUnitsStore((s) => s.temperatureUnit);
  const distanceUnit = useUnitsStore((s) => s.distanceUnit);
  const angularUnit = useUnitsStore((s) => s.angularUnit);
  const setCursorMs = useCursorStore((s) => s.setCursorMs);
  const zoomRange = useCursorStore((s) => s.zoomRange);
  const setZoomRange = useCursorStore((s) => s.setZoomRange);
  const xAxisMode = useCursorStore((s) => s.xAxisMode);

  const [lapDataMap, setLapDataMap] = useState<Map<string, ResampledData>>(
    new Map()
  );
  const [distDataMap, setDistDataMap] = useState<Map<string, DistanceData>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);

  interface LapSource {
    lap: Lap;
    sessionId: string;
    key: string; // unique key (sessionId:lapNum)
    label: string;
  }

  // Collect all active laps (current session + cross-session pins)
  const activeLaps = useMemo(() => {
    const sources: LapSource[] = [];
    const add = (lap: Lap, sid: string, label: string) => {
      const key = `${sid}:${lap.num}`;
      if (sources.some((s) => s.key === key)) return;
      sources.push({ lap, sessionId: sid, key, label });
    };
    if (refLap) add(refLap, sessionId, `L${refLap.num}`);
    if (altLap) add(altLap, sessionId, `L${altLap.num}`);
    for (const l of extraLaps) add(l, sessionId, `L${l.num}`);
    for (const e of crossSessionLaps) {
      add(e.lap, e.sessionId, `L${e.lap.num} @${e.sessionLabel.slice(0, 20)}`);
    }
    return sources;
  }, [refLap, altLap, extraLaps, crossSessionLaps, sessionId]);

  // Fetch resampled data for each active lap
  useEffect(() => {
    if (channels.length === 0 || activeLaps.length === 0) return;
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      const newMap = new Map<string, ResampledData>();
      const promises = activeLaps.map(async (src) => {
        try {
          const data = await fetchResampledData(src.sessionId, channels, src.lap.num);
          if (!cancelled) newMap.set(src.key, data);
        } catch {
          // skip failed fetches
        }
      });
      await Promise.all(promises);
      if (!cancelled) {
        setLapDataMap(newMap);
        setLoading(false);
      }
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [channels, sessionId, activeLaps]);

  // Fetch distance data when in distance mode
  useEffect(() => {
    if (xAxisMode !== "distance" || activeLaps.length === 0) return;
    let cancelled = false;

    async function fetchDist() {
      const newMap = new Map<string, DistanceData>();
      const promises = activeLaps.map(async (src) => {
        try {
          const data = await fetchDistance(src.sessionId, src.lap.num);
          if (!cancelled) newMap.set(src.key, data);
        } catch {
          // skip failed fetches
        }
      });
      await Promise.all(promises);
      if (!cancelled) setDistDataMap(newMap);
    }

    fetchDist();
    return () => { cancelled = true; };
  }, [xAxisMode, sessionId, activeLaps]);

  // Build uPlot data and options from fetched lap data
  const { data, options } = useMemo(() => {
    if (activeLaps.length === 0 || lapDataMap.size === 0) {
      return { data: null, options: null };
    }

    // Build per-lap, per-channel series
    const lapSeries: {
      label: string;
      stroke: string;
      scale: string;
      xSeconds: number[];
      values: number[];
    }[] = [];

    const useDistance = xAxisMode === "distance";

    for (let li = 0; li < activeLaps.length; li++) {
      const src = activeLaps[li];
      const lap = src.lap;
      const rd = lapDataMap.get(src.key);
      if (!rd || rd.rowCount === 0) continue;
      // eslint-disable-next-line no-console
      console.log("[telemetry-chart] " + src.label + " start_ms=" + lap.start_time_ms + " rowCount=" + rd.rowCount + " tc_first=" + JSON.stringify(Array.from(rd.timecodes.slice(0,5))) + " tc_last=" + JSON.stringify(Array.from(rd.timecodes.slice(-3))));
      for (const [chName, vals] of Object.entries(rd.channels)) {
        // eslint-disable-next-line no-console
        console.log("[telemetry-chart]   " + chName + " first5=" + JSON.stringify(Array.from((vals as Float64Array).slice(0, 5))) + " last3=" + JSON.stringify(Array.from((vals as Float64Array).slice(-3))));
      }

      let xValues: number[];
      const offsetMs = lap.start_time_ms;
      if (useDistance) {
        const dd = distDataMap.get(src.key);
        if (!dd) continue; // distance data not loaded yet
        // Map timecodes → distance via nearest-index lookup
        // rd.timecodes are absolute ms; dd.timecodes are lap-relative ms
        xValues = new Array(rd.rowCount);
        for (let i = 0; i < rd.rowCount; i++) {
          const tRel = rd.timecodes[i] - offsetMs; // convert to lap-relative
          // Find nearest timecode in distance data
          let bestIdx = 0;
          let bestDiff = Math.abs(dd.timecodes[0] - tRel);
          for (let j = 1; j < dd.timecodes.length; j++) {
            const diff = Math.abs(dd.timecodes[j] - tRel);
            if (diff < bestDiff) { bestDiff = diff; bestIdx = j; }
            else break; // timecodes are sorted, so once diff increases we're past
          }
          xValues[i] = dd.distance_m[bestIdx];
        }
      } else {
        xValues = new Array(rd.rowCount);
        for (let i = 0; i < rd.rowCount; i++) {
          xValues[i] = (rd.timecodes[i] - offsetMs) / 1000;
        }
      }

      for (let ci = 0; ci < channels.length; ci++) {
        const chName = channels[ci];
        const vals = rd.channels[chName];
        if (!vals) continue;

        // Apply user-selected unit conversion for speed channels
        const meta = sessionChannels?.find((c) => c.name === chName);
        const nativeUnits = meta?.units ?? "";
        let displayUnits = nativeUnits;
        let convertFn: ((v: number) => number) | null = null;
        if (isSpeedUnits(nativeUnits)) {
          displayUnits = SPEED_UNIT_LABEL[speedUnit];
          convertFn = (v) => convertSpeed(v, nativeUnits, speedUnit);
        } else if (isTemperatureUnits(nativeUnits)) {
          displayUnits = TEMP_UNIT_LABEL[temperatureUnit];
          convertFn = (v) => convertTemperature(v, nativeUnits, temperatureUnit);
        } else if (isDistanceUnits(nativeUnits)) {
          displayUnits = DISTANCE_UNIT_LABEL[distanceUnit];
          convertFn = (v) => convertDistance(v, nativeUnits, distanceUnit);
        } else if (isAngularUnits(nativeUnits)) {
          displayUnits = ANGULAR_UNIT_LABEL[angularUnit];
          convertFn = (v) => convertAngular(v, nativeUnits, angularUnit);
        }
        const converted = convertFn
          ? Array.from(vals, convertFn)
          : Array.from(vals);

        const showLapLabel = activeLaps.length > 1;
        const baseLabel = displayUnits ? `${chName} (${displayUnits})` : chName;
        lapSeries.push({
          label: showLapLabel ? `${baseLabel} · ${src.label}` : baseLabel,
          stroke: LAP_COLORS[(li * channels.length + ci) % LAP_COLORS.length],
          scale: chName,
          xSeconds: Array.from(xValues),
          values: converted,
        });
      }
    }

    if (lapSeries.length === 0) return { data: null, options: null };

    // Build distance→timecode reverse lookup for cursor positioning in distance mode.
    // We use the first active lap's distance data to map distance values back to
    // absolute timecodes so the track map cursor dot works correctly.
    let distToMs: ((dist: number) => number) | null = null;
    if (useDistance && activeLaps.length > 0) {
      const firstSrc = activeLaps[0];
      const dd = distDataMap.get(firstSrc.key);
      if (dd && dd.timecodes.length > 1) {
        const dArr = dd.distance_m;
        const tArr = dd.timecodes; // lap-relative ms
        const baseMs = firstSrc.lap.start_time_ms;
        distToMs = (dist: number): number => {
          // Binary search in dArr, then interpolate tArr
          let lo = 0, hi = dArr.length - 1;
          if (dist <= dArr[0]) return tArr[0] + baseMs;
          if (dist >= dArr[hi]) return tArr[hi] + baseMs;
          while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (dArr[mid] <= dist) lo = mid; else hi = mid;
          }
          const frac = (dist - dArr[lo]) / (dArr[hi] - dArr[lo] || 1);
          return Math.round(tArr[lo] + frac * (tArr[hi] - tArr[lo])) + baseMs;
        };
      }
    }

    // All series must share the same x-axis. Since each lap is independently
    // normalized to start at 0, find the union of all x values.
    // For resampled data from the same ref channel, all laps have evenly spaced
    // x values — we use the longest series as the master x-axis and interpolate others.
    // Since lap durations are similar, just use union + null-fill (dense data = minimal gaps).
    const allX = new Set<number>();
    for (const s of lapSeries) {
      for (const x of s.xSeconds) allX.add(Math.round(x * 1000) / 1000); // round to ms
    }
    const xArr = Array.from(allX).sort((a, b) => a - b);

    // Build aligned y arrays via linear interpolation onto the shared x-axis.
    // Union + null-fill left most positions null for each lap (laps are sampled
    // independently so their x values rarely match exactly), causing blank
    // legend values at the cursor.
    const yArrays: (number | null)[][] = lapSeries.map((s) => {
      const xs = s.xSeconds;
      const vs = s.values;
      const n = xs.length;
      if (n === 0) return xArr.map(() => null);
      const out: (number | null)[] = new Array(xArr.length);
      let j = 0;
      for (let i = 0; i < xArr.length; i++) {
        const x = xArr[i];
        if (x <= xs[0]) { out[i] = vs[0]; continue; }
        if (x >= xs[n - 1]) { out[i] = vs[n - 1]; continue; }
        while (j < n - 1 && xs[j + 1] < x) j++;
        const x0 = xs[j], x1 = xs[j + 1];
        const t = (x - x0) / (x1 - x0 || 1);
        out[i] = vs[j] + (vs[j + 1] - vs[j]) * t;
      }
      return out;
    });

    const chartData: uPlot.AlignedData = [
      xArr,
      ...yArrays,
    ] as uPlot.AlignedData;

    // Build axes
    const scaleNames = Array.from(new Set(lapSeries.map((s) => s.scale)));
    const axes: uPlot.Axis[] = [
      {
        stroke: "#888",
        grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
        ticks: { stroke: "#333", width: 1 },
        values: (_u: uPlot, vals: number[]) =>
          useDistance
            ? vals.map((v) => Math.round(v) + "m")
            : vals.map((v) => v.toFixed(1) + "s"),
      },
    ];

    for (let i = 0; i < scaleNames.length; i++) {
      axes.push({
        scale: scaleNames[i],
        side: i % 2 === 0 ? 3 : 1,
        stroke: "#888",
        grid: i === 0 ? { stroke: "rgba(255,255,255,0.06)", width: 1 } : { show: false },
        ticks: { stroke: "#333", width: 1 },
        size: 60,
      });
    }

    const series: uPlot.Series[] = [
      { label: useDistance ? "d" : "t" }, // x-axis
      ...lapSeries.map((s) => ({
        label: s.label,
        stroke: s.stroke,
        width: 1.5,
        scale: s.scale,
        spanGaps: true,
      })),
    ];

    const scales: uPlot.Scales = {
      x: { time: false },
    };
    for (const name of scaleNames) {
      scales[name] = { auto: true };
    }

    const opts: uPlot.Options = {
      width: 800,
      height,
      cursor: {
        sync: { key: SYNC_KEY, setSeries: true },
        drag: { x: true, y: false, setScale: true },
      },
      scales,
      axes,
      series,
      hooks: {
        // Phase 26 follow-up: paint shaded vertical bands under each
        // detected corner before series + grid render. Sky tint for
        // right-handers, amber for left-handers; intensity scales with
        // |peak g| so harder corners stand out.
        drawClear: [
          (u: uPlot) => {
            if (!corners || corners.length === 0) return;
            const ctx = u.ctx;
            const top = u.bbox.top;
            const bottomY = u.bbox.top + u.bbox.height;
            ctx.save();
            for (const c of corners) {
              const sVal = useDistance ? c.startM : c.startSec;
              const eVal = useDistance ? c.endM : c.endSec;
              if (sVal == null || eVal == null || eVal <= sVal) continue;
              const x1 = u.valToPos(sVal, "x", true);
              const x2 = u.valToPos(eVal, "x", true);
              if (!isFinite(x1) || !isFinite(x2)) continue;
              ctx.fillStyle =
                c.direction === "right"
                  ? "rgba(56, 189, 248, 0.10)"
                  : "rgba(245, 158, 11, 0.10)";
              ctx.fillRect(x1, top, x2 - x1, bottomY - top);
            }
            ctx.restore();
          },
        ],
        setCursor: [
          (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx != null && idx >= 0 && idx < xArr.length) {
              if (useDistance && distToMs) {
                // xArr is meters — reverse-map to absolute timecode ms
                setCursorMs(distToMs(xArr[idx]));
              } else {
                // xArr is seconds — convert to ms
                setCursorMs(xArr[idx] * 1000);
              }
            } else {
              setCursorMs(null);
            }
          },
        ],
        setScale: [
          (u: uPlot, scaleKey: string) => {
            if (scaleKey === "x") {
              const xScale = u.scales.x;
              if (xScale.min != null && xScale.max != null) {
                setZoomRange({ min: xScale.min, max: xScale.max });
              }
            }
          },
        ],
      },
      legend: { show: true },
    };

    return { data: chartData, options: opts };
  }, [activeLaps, lapDataMap, distDataMap, channels, height, setCursorMs, setZoomRange, xAxisMode, speedUnit, temperatureUnit, distanceUnit, angularUnit, sessionChannels, corners]);

  // Resize observer to keep chart width in sync with container
  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (container && chart) {
      chart.setSize({
        width: container.clientWidth,
        height,
      });
    }
  }, [height]);

  // Create / update chart
  useEffect(() => {
    if (!options || !data || !containerRef.current) return;

    let cancelled = false;

    async function init() {
      if (!uPlotModule.current) {
        const mod = await import("uplot");
        uPlotModule.current = mod.default;
        await import("uplot/dist/uPlot.min.css");
      }

      if (cancelled || !containerRef.current) return;
      const UPlot = uPlotModule.current;

      // Destroy previous instance
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      const opts = {
        ...options,
        width: containerRef.current.clientWidth,
        height: options?.height ?? height,
      } as uPlot.Options;

      chartRef.current = new UPlot(opts, data ?? undefined, containerRef.current);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [options, data, height]);

  // Sync zoom range from other charts
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !zoomRange) return;

    const currentMin = chart.scales.x.min;
    const currentMax = chart.scales.x.max;
    // Only apply if different (prevent infinite loop)
    if (
      currentMin != null &&
      currentMax != null &&
      (Math.abs(currentMin - zoomRange.min) > 0.01 ||
        Math.abs(currentMax - zoomRange.max) > 0.01)
    ) {
      chart.setScale("x", zoomRange);
    }
  }, [zoomRange]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [handleResize]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  // Reset zoom handler
  const handleResetZoom = useCallback(() => {
    setZoomRange(null);
    if (chartRef.current) {
      chartRef.current.setScale("x", { min: undefined as unknown as number, max: undefined as unknown as number });
    }
  }, [setZoomRange]);

  // ---- T3.1b — right-click context menu ---------------------------------
  const setChatOpen = useChatStore((s) => s.setOpen);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);
  const [menu, setMenu] = useState<ChartContextMenuState | null>(null);

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const chart = chartRef.current;
      const container = containerRef.current;
      if (!chart || !container) return;
      e.preventDefault();

      // Translate event coords → chart x value
      const rect = container.getBoundingClientRect();
      const xPx = e.clientX - rect.left - chart.bbox.left / window.devicePixelRatio;
      let xVal: number | null = null;
      try {
        xVal = chart.posToVal(xPx, "x");
      } catch {
        xVal = null;
      }
      if (!Number.isFinite(xVal)) xVal = null;

      const useDistance = xAxisMode === "distance";
      const distLabel =
        xVal != null
          ? useDistance
            ? `${Math.round(xVal)} m`
            : `${xVal.toFixed(2)} s`
          : "this point";
      const lapNum = refLap?.num;
      const channel = channels[0];

      const items = [
        {
          label: "Ask Stint about this point",
          icon: "chat" as const,
          onSelect: () => {
            const parts: string[] = [];
            if (lapNum != null) parts.push(`On lap ${lapNum}`);
            if (xVal != null) parts.push(`at ${distLabel}`);
            const ask = `${parts.join(" ")}, what's happening with ${channel}?`.trim();
            setPendingPrompt(ask);
            setChatOpen(true);
          },
        },
        {
          label: "Set as cursor",
          icon: "cursor" as const,
          onSelect: () => {
            if (xVal == null) return;
            // Cursor store expects ms (lap-relative). When in time mode, xVal
            // is seconds. Distance mode requires distToMs which lives in the
            // memo above — fall back to nearest-index lookup via uPlot.
            if (useDistance) {
              const idx = chart.cursor.idx;
              if (idx != null) {
                // Nudge cursor by triggering the existing setCursor hook
                chart.setCursor({ left: e.clientX - rect.left, top: 0 });
              }
            } else {
              setCursorMs(xVal * 1000);
            }
          },
        },
      ];

      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [xAxisMode, refLap?.num, channels, setPendingPrompt, setChatOpen, setCursorMs],
  );

  if (loading && lapDataMap.size === 0) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Loading {channels.join(", ")}...
      </div>
    );
  }

  if (!options || !data) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        {activeLaps.length === 0
          ? "Select a lap to view data"
          : "No telemetry data available"}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onContextMenu={onContextMenu}
        className="w-full bg-[#0c0c0c] rounded-lg overflow-hidden"
        style={{ minHeight: height }}
      />
      {zoomRange && (
        <button
          onClick={handleResetZoom}
          className="absolute top-2 right-2 px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded text-white/70 transition-colors"
        >
          Reset Zoom
        </button>
      )}
      <ChartContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
