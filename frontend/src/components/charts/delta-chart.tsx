"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLapStore } from "@/stores/lap-store";
import { useCursorStore } from "@/stores/cursor-store";
import { fetchDeltaT, fetchDistance, type DeltaTData, type DistanceData } from "@/lib/api";
import type uPlot from "uplot";

interface DeltaChartProps {
  sessionId: string;
  height?: number;
}

const SYNC_KEY = "telemetry";

export function DeltaChart({ sessionId, height = 200 }: DeltaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const uPlotModule = useRef<typeof uPlot | null>(null);

  const { refLap, altLap } = useLapStore();
  const zoomRange = useCursorStore((s) => s.zoomRange);
  const xAxisMode = useCursorStore((s) => s.xAxisMode);
  const setCursorMs = useCursorStore((s) => s.setCursorMs);
  const [deltaData, setDeltaData] = useState<DeltaTData | null>(null);
  const [refDist, setRefDist] = useState<DistanceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!refLap || !altLap) {
      setDeltaData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    fetchDeltaT(sessionId, refLap.num, altLap.num)
      .then((d) => {
        if (!cancelled) setDeltaData(d);
      })
      .catch(() => {
        if (!cancelled) setDeltaData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId, refLap, altLap]);

  // Fetch ref lap distance mapping (to convert distance→time when in time mode)
  useEffect(() => {
    if (!refLap) { setRefDist(null); return; }
    let cancelled = false;
    fetchDistance(sessionId, refLap.num)
      .then((d) => { if (!cancelled) setRefDist(d); })
      .catch(() => { if (!cancelled) setRefDist(null); });
    return () => { cancelled = true; };
  }, [sessionId, refLap]);

  const { data, options } = useMemo(() => {
    if (!deltaData || deltaData.distance_m.length === 0) {
      return { data: null, options: null };
    }

    const useDistance = xAxisMode === "distance";

    // Build x-array: either meters (distance mode) or seconds (time mode, via ref lap distance→time lookup)
    let xArr: number[];
    if (useDistance || !refDist || refDist.distance_m.length === 0) {
      xArr = Array.from(deltaData.distance_m);
    } else {
      // For each distance in deltaData, find nearest distance in refDist and use its timecode
      xArr = new Array(deltaData.distance_m.length);
      let j = 0;
      const n = refDist.distance_m.length;
      for (let i = 0; i < deltaData.distance_m.length; i++) {
        const d = deltaData.distance_m[i];
        // advance j while next point is closer
        while (j < n - 1 && refDist.distance_m[j + 1] <= d) j++;
        // linear interp between j and j+1
        if (j < n - 1) {
          const d0 = refDist.distance_m[j];
          const d1 = refDist.distance_m[j + 1];
          const t0 = refDist.timecodes[j];
          const t1 = refDist.timecodes[j + 1];
          const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
          xArr[i] = (t0 + f * (t1 - t0)) / 1000; // seconds
        } else {
          xArr[i] = refDist.timecodes[n - 1] / 1000;
        }
      }
    }

    const chartData: uPlot.AlignedData = [
      xArr,
      Array.from(deltaData.delta_seconds),
    ] as uPlot.AlignedData;

    const opts: uPlot.Options = {
      width: 800,
      height,
      cursor: {
        sync: { key: SYNC_KEY, setSeries: true },
        drag: { x: true, y: false, setScale: true },
      },
      scales: {
        x: { auto: true, time: false },
        y: { auto: true },
      },
      axes: [
        {
          stroke: "#888",
          grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
          ticks: { stroke: "#333", width: 1 },
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) =>
              xAxisMode === "distance" ? Math.round(v) + "m" : v.toFixed(1) + "s"
            ),
        },
        {
          stroke: "#888",
          grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
          ticks: { stroke: "#333", width: 1 },
          size: 60,
          values: (_u: uPlot, vals: number[]) =>
            vals.map((v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "s"),
        },
      ],
      series: [
        { label: xAxisMode === "distance" ? "d" : "t" },
        {
          label: `Δt (L${altLap?.num} vs L${refLap?.num})`,
          stroke: "#f97316",
          width: 2,
          fill: (self: uPlot) => {
            // Green when ref ahead (positive delta), red when behind (negative)
            const ctx = self.ctx;
            const zeroY = self.valToPos(0, "y", true);
            // Guard against non-finite values during init
            if (!isFinite(zeroY)) return "rgba(249, 115, 22, 0.15)";
            const gradient = ctx.createLinearGradient(0, zeroY, 0, 0);
            gradient.addColorStop(0, "rgba(34, 197, 94, 0.3)");
            gradient.addColorStop(1, "rgba(239, 68, 68, 0.3)");
            return gradient;
          },
        },
      ],
      legend: { show: true },
      hooks: {
        setCursor: [
          (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0 || idx >= xArr.length) {
              setCursorMs(null);
              return;
            }
            if (xAxisMode === "distance") {
              // Map distance → ref lap time
              if (!refDist || refDist.distance_m.length === 0) return;
              const d = xArr[idx];
              let j = 0;
              const n = refDist.distance_m.length;
              while (j < n - 1 && refDist.distance_m[j + 1] <= d) j++;
              if (j < n - 1) {
                const d0 = refDist.distance_m[j];
                const d1 = refDist.distance_m[j + 1];
                const t0 = refDist.timecodes[j];
                const t1 = refDist.timecodes[j + 1];
                const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
                setCursorMs(t0 + f * (t1 - t0));
              } else {
                setCursorMs(refDist.timecodes[n - 1]);
              }
            } else {
              setCursorMs(xArr[idx] * 1000);
            }
          },
        ],
      },
    };

    return { data: chartData, options: opts };
  }, [deltaData, refDist, height, refLap, altLap, xAxisMode]);

  const handleResize = useCallback(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (container && chart) {
      chart.setSize({ width: container.clientWidth, height });
    }
  }, [height]);

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

      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }

      chartRef.current = new uPlotModule.current(
        { ...options, width: containerRef.current.clientWidth } as uPlot.Options,
        data ?? undefined,
        containerRef.current
      );
    }

    init();
    return () => { cancelled = true; };
  }, [options, data, height]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [handleResize]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  if (!refLap || !altLap) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Select two laps to see time delta
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Computing delta-T...
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
    </div>
  );
}
