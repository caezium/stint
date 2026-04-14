"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface HistogramChartProps {
  data: number[];
  channelName: string;
  units: string;
  bins?: number;
}

function computeHistogram(values: number[], binCount: number) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ range: `${min.toFixed(1)}`, rangeLabel: `${min.toFixed(1)}`, count: values.length }];
  }

  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    return {
      range: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      rangeLabel: ((lo + hi) / 2).toFixed(1),
      lo,
      hi,
      count: 0,
    };
  });

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].count++;
  }

  return bins;
}

export function HistogramChart({
  data,
  channelName,
  units,
  bins: binCount = 20,
}: HistogramChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  const histogram = computeHistogram(data, binCount);

  return (
    <div className="w-full">
      <h3 className="text-sm font-medium text-zinc-300 mb-2">
        {channelName} Distribution
        {units && <span className="text-zinc-500 ml-1">({units})</span>}
      </h3>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={histogram}
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
                value: "Count",
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
              formatter={(value) => [String(value), "Count"]}
              labelFormatter={(label) => `${label} ${units}`}
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
