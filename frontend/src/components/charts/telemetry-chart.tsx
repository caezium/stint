"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useLapStore } from "@/stores/lap-store";
import { useCursorStore } from "@/stores/cursor-store";
import { useSessionStore } from "@/stores/session-store";
import { useUnitsStore, isSpeedUnits, convertSpeed, SPEED_UNIT_LABEL } from "@/stores/units-store";
import { fetchResampledData, fetchDistance, type ResampledData, type DistanceData } from "@/lib/api";
import type uPlot from "uplot";
import type { Lap } from "@/lib/api";

interface TelemetryChartProps {
  channels: string[];
  sessionId: string;
  height?: number;
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
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const uPlotModule = useRef<typeof uPlot | null>(null);

  const { refLap, altLap, extraLaps, crossSessionLaps } = useLapStore();
  const sessionChannels = useSessionStore((s) => s.session?.channels);
  const speedUnit = useUnitsStore((s) => s.speedUnit);
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
        const isSpeed = isSpeedUnits(nativeUnits);
        const displayUnits = isSpeed ? SPEED_UNIT_LABEL[speedUnit] : nativeUnits;
        const converted = isSpeed
          ? Array.from(vals, (v) => convertSpeed(v, nativeUnits, speedUnit))
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
      {}, // x-axis placeholder
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
        setCursor: [
          (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx != null && idx >= 0 && idx < xArr.length) {
              setCursorMs(xArr[idx] * 1000);
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
  }, [activeLaps, lapDataMap, distDataMap, channels, height, setCursorMs, setZoomRange, xAxisMode, speedUnit, sessionChannels]);

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

      chartRef.current = new UPlot(opts, data, containerRef.current);
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
    </div>
  );
}
