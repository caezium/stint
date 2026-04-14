"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import type { Lap } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface LapTimeChartProps {
  laps: Lap[];
  refLapNum: number | null;
}

function lapColor(duration: number, best: number, worst: number): string {
  if (worst === best) return "#22c55e";
  const ratio = (duration - best) / (worst - best);
  // green → yellow → red
  const r = Math.round(34 + ratio * (239 - 34));
  const g = Math.round(197 - ratio * (197 - 68));
  const b = Math.round(94 - ratio * (94 - 68));
  return `rgb(${r},${g},${b})`;
}

export function LapTimeChart({ laps, refLapNum }: LapTimeChartProps) {
  const validLaps = laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  if (validLaps.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No lap data available
      </div>
    );
  }

  const times = validLaps.map((l) => l.duration_ms);
  const best = Math.min(...times);
  const worst = Math.max(...times);

  const data = validLaps.map((l) => ({
    lap: `L${l.num}`,
    time: l.duration_ms / 1000,
    duration_ms: l.duration_ms,
    isRef: l.num === refLapNum,
    color: lapColor(l.duration_ms, best, worst),
    label: formatLapTime(l.duration_ms),
  }));

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 80, bottom: 8, left: 40 }}
          barCategoryGap="20%"
        >
          <XAxis
            type="number"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
            domain={["dataMin - 0.5", "dataMax + 0.5"]}
            tickFormatter={(v: number) => `${v.toFixed(1)}s`}
          />
          <YAxis
            type="category"
            dataKey="lap"
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              color: "#f4f4f5",
              fontSize: 12,
            }}
            formatter={(value, _name, entry) => [
              (entry as { payload: { label: string } }).payload.label,
              "Lap Time",
            ]}
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
          />
          <Bar dataKey="time" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.color}
                stroke={entry.isRef ? "#fff" : "none"}
                strokeWidth={entry.isRef ? 2 : 0}
              />
            ))}
            <LabelList
              dataKey="label"
              position="right"
              style={{ fill: "#d4d4d8", fontSize: 11, fontFamily: "monospace" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
