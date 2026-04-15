"use client";

import { useEffect, useState, useMemo } from "react";
import { useLapStore } from "@/stores/lap-store";
import { fetchPredictive, type PredictiveData } from "@/lib/api";

interface Props {
  sessionId: string;
  height?: number;
}

export function PredictiveChart({ sessionId, height = 220 }: Props) {
  const { refLap, altLap } = useLapStore();
  const [data, setData] = useState<PredictiveData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Use altLap as "current", refLap as "reference fast lap"
  const refNum = refLap?.num;
  const curNum = altLap?.num;

  useEffect(() => {
    if (refNum == null || curNum == null || refNum === curNum) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetchPredictive(sessionId, refNum, curNum)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed");
          setData(null);
        }
      });
    return () => { cancelled = true; };
  }, [sessionId, refNum, curNum]);

  const { pathPos, pathNeg, pathLine, xMax, yMax } = useMemo(() => {
    if (!data || data.distance.length < 2) {
      return { pathPos: "", pathNeg: "", pathLine: "", xMax: 1, yMax: 1 };
    }
    const W = 800;
    const H = height;
    const padL = 48;
    const padR = 12;
    const padT = 12;
    const padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const dist = data.distance;
    const delta = data.delta_ms;
    const xMaxLocal = dist[dist.length - 1] || 1;
    const yMaxAbs = Math.max(1, ...delta.map((v) => Math.abs(v)));

    const x = (d: number) => padL + (d / xMaxLocal) * innerW;
    const y = (v: number) => padT + innerH / 2 - (v / yMaxAbs) * (innerH / 2);

    // Line path
    const lineParts: string[] = [];
    for (let i = 0; i < dist.length; i++) {
      lineParts.push(`${i === 0 ? "M" : "L"} ${x(dist[i]).toFixed(1)} ${y(delta[i]).toFixed(1)}`);
    }

    // Positive (losing) and negative (gaining) fill polygons
    const zeroY = y(0);
    const posParts: string[] = [`M ${x(dist[0]).toFixed(1)} ${zeroY.toFixed(1)}`];
    for (let i = 0; i < dist.length; i++) {
      const v = Math.max(0, delta[i]);
      posParts.push(`L ${x(dist[i]).toFixed(1)} ${y(v).toFixed(1)}`);
    }
    posParts.push(`L ${x(dist[dist.length - 1]).toFixed(1)} ${zeroY.toFixed(1)} Z`);

    const negParts: string[] = [`M ${x(dist[0]).toFixed(1)} ${zeroY.toFixed(1)}`];
    for (let i = 0; i < dist.length; i++) {
      const v = Math.min(0, delta[i]);
      negParts.push(`L ${x(dist[i]).toFixed(1)} ${y(v).toFixed(1)}`);
    }
    negParts.push(`L ${x(dist[dist.length - 1]).toFixed(1)} ${zeroY.toFixed(1)} Z`);

    return {
      pathPos: posParts.join(" "),
      pathNeg: negParts.join(" "),
      pathLine: lineParts.join(" "),
      xMax: xMaxLocal,
      yMax: yMaxAbs,
    };
  }, [data, height]);

  if (refNum == null || curNum == null) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Select a reference (fast) lap and an alternate (current) lap
      </div>
    );
  }
  if (refNum === curNum) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Reference lap and current lap must differ
      </div>
    );
  }
  if (err || !data || data.distance.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        {err ?? "Loading predictive..."}
      </div>
    );
  }

  const W = 800;
  const H = height;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;

  return (
    <div style={{ height }} className="bg-[#0c0c0c] rounded-lg overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* Zero baseline */}
        <line
          x1={padL}
          x2={W - padR}
          y1={zeroY}
          y2={zeroY}
          stroke="#555"
          strokeWidth={1}
        />
        {/* Fills */}
        <path d={pathNeg} fill="#22c55e" opacity={0.25} />
        <path d={pathPos} fill="#ef4444" opacity={0.25} />
        {/* Line */}
        <path d={pathLine} stroke="#facc15" strokeWidth={1.5} fill="none" />
        {/* Axes */}
        <text x={padL - 6} y={padT + 10} fontSize={10} fill="#888" textAnchor="end">
          +{(yMax / 1000).toFixed(2)}s
        </text>
        <text x={padL - 6} y={padT + innerH - 2} fontSize={10} fill="#888" textAnchor="end">
          -{(yMax / 1000).toFixed(2)}s
        </text>
        <text x={padL - 6} y={zeroY + 3} fontSize={10} fill="#888" textAnchor="end">
          0
        </text>
        <text x={padL} y={H - 8} fontSize={10} fill="#888">
          0m
        </text>
        <text x={W - padR} y={H - 8} fontSize={10} fill="#888" textAnchor="end">
          {Math.round(xMax)}m
        </text>
        <text x={W / 2} y={H - 8} fontSize={10} fill="#888" textAnchor="middle">
          Distance
        </text>
      </svg>
    </div>
  );
}
