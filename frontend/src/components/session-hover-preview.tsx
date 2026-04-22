"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchSessionPreview,
  type SessionPreviewData,
} from "@/lib/api";
import { formatLapTime } from "@/lib/constants";
import { TAG_LABEL, TAG_STYLE } from "@/components/session-tag-badges";

interface Props {
  sessionId: string;
  children: React.ReactNode;
}

/**
 * Hover preview popover (Phase 21.2). Wraps a session card and shows a
 * lightweight sparkline + map thumbnail + weather + narrative snippet when
 * the user hovers. Data fetched once per hover and cached for the session
 * lifetime.
 */
export function SessionHoverPreview({ sessionId, children }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SessionPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    fetchSessionPreview(sessionId)
      .then((d) => !cancelled && setData(d))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : "Failed"),
      );
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, data]);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (data || error) && (
        <div className="absolute left-full top-0 ml-2 z-30 w-[280px] rounded-lg border border-border/60 bg-card/95 backdrop-blur p-3 shadow-xl text-xs pointer-events-none">
          {error && <div className="text-destructive">{error}</div>}
          {data && <PreviewBody data={data} />}
        </div>
      )}
    </div>
  );
}

function PreviewBody({ data }: { data: SessionPreviewData }) {
  const { session, lap_times_ms, pit_mask, tags, weather, narrative_summary, gps_outline } = data;

  const { best, worst } = useMemo(() => {
    let bestV = Infinity;
    let worstV = 0;
    for (let i = 0; i < lap_times_ms.length; i++) {
      if (pit_mask[i]) continue;
      const v = lap_times_ms[i];
      if (v > 0 && v < bestV) bestV = v;
      if (v > 0 && v > worstV) worstV = v;
    }
    return {
      best: Number.isFinite(bestV) ? bestV : null,
      worst: worstV > 0 ? worstV : null,
    };
  }, [lap_times_ms, pit_mask]);

  return (
    <>
      <div className="flex items-baseline justify-between mb-1">
        <div className="font-semibold text-foreground truncate">
          {session.venue || "Unknown"}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {session.log_date}
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground mb-2">
        {session.driver} · {session.lap_count} laps
        {session.best_lap_time_ms ? (
          <span className="text-green-400 font-mono ml-2">
            best {formatLapTime(session.best_lap_time_ms)}
          </span>
        ) : null}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map((t) => (
            <span
              key={t}
              className={`text-[9px] px-1.5 py-0.5 rounded-full border ${TAG_STYLE[t] ?? "border-border/40 text-muted-foreground"}`}
            >
              {TAG_LABEL[t] ?? t}
            </span>
          ))}
        </div>
      )}
      {/* Sparkline */}
      {lap_times_ms.length > 0 && best != null && worst != null && (
        <Sparkline
          values={lap_times_ms}
          pitMask={pit_mask}
          best={best}
          worst={worst}
        />
      )}
      {/* Map thumbnail */}
      {gps_outline.length > 1 && (
        <MapThumbnail outline={gps_outline} />
      )}
      {weather && (
        <div className="text-[10px] text-muted-foreground mt-2">
          Weather · {weather}
        </div>
      )}
      {narrative_summary && (
        <div className="text-[11px] text-muted-foreground/90 mt-2 leading-snug italic">
          {narrative_summary}
        </div>
      )}
    </>
  );
}

function Sparkline({
  values,
  pitMask,
  best,
  worst,
}: {
  values: number[];
  pitMask: boolean[];
  best: number;
  worst: number;
}) {
  const w = 248;
  const h = 44;
  const pad = 2;
  const range = Math.max(1, worst - best);
  const n = values.length;
  const xStep = (w - pad * 2) / Math.max(1, n - 1);
  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const y = h - pad - ((v - best) / range) * (h - pad * 2);
    points.push(`${pad + i * xStep},${y}`);
  }
  return (
    <svg width={w} height={h} className="mb-2 block">
      <rect x={0} y={0} width={w} height={h} fill="#0a0a0a" rx={4} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#10b981"
        strokeWidth={1.5}
      />
      {values.map((v, i) => {
        if (pitMask[i]) return null;
        const y = h - pad - ((v - best) / range) * (h - pad * 2);
        const color = v === best ? "#10b981" : v === worst ? "#f59e0b" : null;
        if (!color) return null;
        return (
          <circle
            key={i}
            cx={pad + i * xStep}
            cy={y}
            r={2.5}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

function MapThumbnail({ outline }: { outline: number[][] }) {
  const W = 248;
  const H = 80;
  const pad = 4;
  const lats = outline.map((p) => p[0]);
  const lons = outline.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const meanLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const rangeLat = maxLat - minLat || 1e-6;
  const rangeLon = (maxLon - minLon) * cosLat || 1e-6;
  const scale = Math.min((W - pad * 2) / rangeLon, (H - pad * 2) / rangeLat);
  const offX = pad + ((W - pad * 2) - rangeLon * scale) / 2;
  const offY = pad + ((H - pad * 2) - rangeLat * scale) / 2;
  const points = outline
    .map(([la, lo]) => {
      const x = offX + (lo * cosLat - minLon * cosLat) * scale;
      const y = H - offY - (la - minLat) * scale;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="block rounded">
      <rect width={W} height={H} fill="#0a0a0a" rx={4} />
      <polyline
        points={points}
        fill="none"
        stroke="#eab308"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}
