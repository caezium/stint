"use client";

import { useEffect, useMemo, useState } from "react";
import { useLapStore } from "@/stores/lap-store";
import { useSessionStore } from "@/stores/session-store";
import { fetchResampledData } from "@/lib/api";

interface Props {
  sessionId: string;
  height?: number;
}

const SUSP_RE = /(damper|shock|susp).*(pos|travel)/i;

export function SuspensionChart({ sessionId, height = 220 }: Props) {
  const { refLap } = useLapStore();
  const session = useSessionStore((s) => s.session);

  const candidates = useMemo(() => {
    if (!session) return [];
    return session.channels.filter((c) => SUSP_RE.test(c.name)).map((c) => c.name);
  }, [session]);

  const [velocities, setVelocities] = useState<Record<string, number[]>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!refLap || candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchResampledData(sessionId, candidates, refLap.num);
        if (cancelled) return;
        const out: Record<string, number[]> = {};
        const tcs = data.timecodes;
        for (const name of candidates) {
          const vals = data.channels[name];
          if (!vals || vals.length < 2) continue;
          const vel = new Array<number>(vals.length - 1);
          for (let i = 1; i < vals.length; i++) {
            const dt = (tcs[i] - tcs[i - 1]) / 1000; // seconds
            if (dt > 0) {
              vel[i - 1] = (vals[i] - vals[i - 1]) / dt;
            } else {
              vel[i - 1] = 0;
            }
          }
          out[name] = vel;
        }
        setVelocities(out);
        setErr(null);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, refLap, candidates]);

  if (candidates.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        No suspension data
      </div>
    );
  }

  if (!refLap) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Select a lap
      </div>
    );
  }

  const names = Object.keys(velocities);
  if (err) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        {err}
      </div>
    );
  }
  if (names.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Loading velocities…
      </div>
    );
  }

  // Histogram of all velocities combined
  const all = names.flatMap((n) => velocities[n]);
  const binCount = 30;
  const absMax = Math.max(1, ...all.map((v) => Math.abs(v)));
  const bins = new Array<number>(binCount).fill(0);
  for (const v of all) {
    const frac = (v + absMax) / (2 * absMax);
    const bi = Math.min(binCount - 1, Math.max(0, Math.floor(frac * binCount)));
    bins[bi]++;
  }
  const binMax = Math.max(1, ...bins);

  const W = 800;
  const H = height;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const bw = innerW / binCount;

  return (
    <div style={{ height }} className="bg-[#0c0c0c] rounded-lg">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {bins.map((c, i) => {
          const h = (c / binMax) * innerH;
          const x = padL + i * bw;
          const y = padT + innerH - h;
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, bw - 1)}
              height={h}
              fill="#3b82f6"
              opacity={0.75}
            />
          );
        })}
        <line
          x1={padL + innerW / 2}
          x2={padL + innerW / 2}
          y1={padT}
          y2={padT + innerH}
          stroke="#666"
          strokeDasharray="3 3"
        />
        <text x={padL} y={H - 8} fontSize={10} fill="#888">
          -{absMax.toFixed(1)}
        </text>
        <text x={padL + innerW / 2} y={H - 8} fontSize={10} fill="#888" textAnchor="middle">
          velocity (units/s)
        </text>
        <text x={W - padR} y={H - 8} fontSize={10} fill="#888" textAnchor="end">
          +{absMax.toFixed(1)}
        </text>
        <text x={padL - 6} y={padT + 10} fontSize={10} fill="#888" textAnchor="end">
          {binMax}
        </text>
        <text x={padL - 6} y={padT + innerH} fontSize={10} fill="#888" textAnchor="end">
          0
        </text>
        <text x={W / 2} y={padT + 12} fontSize={10} fill="#a3a3a3" textAnchor="middle">
          Suspension velocity histogram ({names.length} ch)
        </text>
      </svg>
    </div>
  );
}
