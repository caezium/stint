"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Cell,
  ReferenceLine,
} from "recharts";

interface HistogramChartProps {
  data: number[];
  channelName: string;
  units: string;
  bins?: number;
  /** Secondary channel values (aligned 1-to-1 with `data`) used to colour
   * each bin by the mean of the secondary channel in that bin. Phase 17.1. */
  secondary?: { name: string; values: number[] } | null;
}

interface Bin {
  rangeLabel: string;
  lo: number;
  hi: number;
  mid: number;
  count: number;
  cum: number;
  secondaryMean: number | null;
}

function computeHistogram(
  values: number[],
  binCount: number,
  secondary?: number[] | null
): Bin[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of clean) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    return [
      {
        rangeLabel: min.toFixed(1),
        lo: min,
        hi: min,
        mid: min,
        count: clean.length,
        cum: clean.length,
        secondaryMean: null,
      },
    ];
  }

  const binWidth = (max - min) / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    return {
      rangeLabel: ((lo + hi) / 2).toFixed(1),
      lo,
      hi,
      mid: (lo + hi) / 2,
      count: 0,
      cum: 0,
      secondaryMean: null,
    };
  });
  const secondarySums: number[] = new Array(binCount).fill(0);
  const secondaryCounts: number[] = new Array(binCount).fill(0);

  for (let i = 0; i < clean.length; i++) {
    const v = clean[i];
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
    if (secondary && i < secondary.length && Number.isFinite(secondary[i])) {
      secondarySums[idx] += secondary[i];
      secondaryCounts[idx]++;
    }
  }
  let running = 0;
  for (let i = 0; i < bins.length; i++) {
    running += bins[i].count;
    bins[i].cum = running;
    if (secondaryCounts[i] > 0) {
      bins[i].secondaryMean = secondarySums[i] / secondaryCounts[i];
    }
  }
  return bins;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) if (Number.isFinite(v)) s += v;
  return s / values.length;
}

function stddev(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    s += (v - mu) ** 2;
    n++;
  }
  return Math.sqrt(s / n);
}

// Map a normalised secondary mean [0..1] to a blue → yellow → red ramp.
function secondaryColor(t: number): string {
  if (!Number.isFinite(t)) return "#3b82f6";
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    const f = clamped / 0.5;
    const r = Math.round(59 + f * (234 - 59));
    const g = Math.round(130 + f * (179 - 130));
    const b = Math.round(246 + f * (8 - 246));
    return `rgb(${r},${g},${b})`;
  }
  const f = (clamped - 0.5) / 0.5;
  const r = Math.round(234 + f * (239 - 234));
  const g = Math.round(179 + f * (68 - 179));
  const b = Math.round(8 + f * (68 - 8));
  return `rgb(${r},${g},${b})`;
}

export function HistogramChart({
  data,
  channelName,
  units,
  bins: binCount = 20,
  secondary = null,
}: HistogramChartProps) {
  const [cumulative, setCumulative] = useState(false);
  const [showNormal, setShowNormal] = useState(false);

  const histogram = useMemo(
    () => computeHistogram(data, binCount, secondary?.values ?? null),
    [data, binCount, secondary?.values]
  );

  const stats = useMemo(() => {
    const mu = mean(data);
    const sigma = stddev(data, mu);
    return { mean: mu, stddev: sigma };
  }, [data]);

  // Normal-distribution curve scaled to match histogram counts.
  const withNormalCurve = useMemo(() => {
    if (!showNormal || histogram.length === 0 || stats.stddev === 0) {
      return histogram.map((b) => ({ ...b, normal: null as number | null }));
    }
    const binWidth = histogram[0].hi - histogram[0].lo;
    const n = data.length;
    const scale = n * binWidth;
    return histogram.map((b) => {
      const z = (b.mid - stats.mean) / stats.stddev;
      const pdf = Math.exp(-0.5 * z * z) / (stats.stddev * Math.sqrt(2 * Math.PI));
      return { ...b, normal: pdf * scale };
    });
  }, [histogram, showNormal, stats, data.length]);

  const secondaryRange = useMemo(() => {
    const means = histogram
      .map((b) => b.secondaryMean)
      .filter((v): v is number => v != null);
    if (means.length === 0) return null;
    return { min: Math.min(...means), max: Math.max(...means) };
  }, [histogram]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  const valueKey = cumulative ? "cum" : "count";

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-medium text-zinc-300">
            {channelName} Distribution
            {units && <span className="text-zinc-500 ml-1">({units})</span>}
          </h3>
          <div className="text-[10px] text-muted-foreground">
            mean <span className="font-mono text-foreground">{stats.mean.toFixed(2)}</span> · σ{" "}
            <span className="font-mono text-foreground">{stats.stddev.toFixed(2)}</span>
            {secondary && secondaryRange && (
              <span>
                {" "}
                · coloured by {secondary.name} ({secondaryRange.min.toFixed(1)}–
                {secondaryRange.max.toFixed(1)})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={cumulative}
              onChange={(e) => setCumulative(e.target.checked)}
              className="h-3 w-3 accent-primary"
            />
            Cumulative
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={showNormal}
              onChange={(e) => setShowNormal(e.target.checked)}
              className="h-3 w-3 accent-primary"
              disabled={cumulative}
            />
            Normal curve
          </label>
        </div>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={withNormalCurve}
            margin={{ top: 8, right: 16, bottom: 24, left: 16 }}
          >
            <XAxis
              dataKey="rangeLabel"
              tick={{ fill: "#a1a1aa", fontSize: 10 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
              angle={-45}
              textAnchor="end"
              interval="preserveStartEnd"
              label={{
                value: units || channelName,
                position: "insideBottom",
                offset: -16,
                style: { fill: "#71717a", fontSize: 11 },
              }}
            />
            <YAxis
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
              label={{
                value: cumulative ? "Cumulative" : "Count",
                angle: -90,
                position: "insideLeft",
                style: { fill: "#71717a", fontSize: 11 },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 6,
                color: "#f4f4f5",
                fontSize: 12,
              }}
              formatter={(value, name) => {
                if (name === "normal") return [Number(value).toFixed(1), "Expected"];
                return [String(value), cumulative ? "Cumulative" : "Count"];
              }}
              labelFormatter={(label) => `${label} ${units}`}
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
            />
            <Bar dataKey={valueKey} radius={[2, 2, 0, 0]}>
              {withNormalCurve.map((bin, i) => {
                let color = "#3b82f6";
                if (secondary && secondaryRange && bin.secondaryMean != null) {
                  const range = secondaryRange.max - secondaryRange.min || 1;
                  const t = (bin.secondaryMean - secondaryRange.min) / range;
                  color = secondaryColor(t);
                }
                return <Cell key={`cell-${i}`} fill={color} />;
              })}
            </Bar>
            {showNormal && !cumulative && (
              <Line
                type="monotone"
                dataKey="normal"
                stroke="#facc15"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {!cumulative && (
              <ReferenceLine
                x={stats.mean.toFixed(1)}
                stroke="#10b981"
                strokeDasharray="3 3"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
