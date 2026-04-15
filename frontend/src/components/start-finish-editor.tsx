"use client";

import { useState, useMemo } from "react";
import { recomputeLapsFromLine, type TrackData } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  sessionId: string;
  track: TrackData | null;
  onRecomputed: () => void;
}

/**
 * SVG track outline with click-to-place start/finish line.
 * Click twice to drop two points; click "Recompute" to rebuild laps from GPS
 * trajectory crossings of that line.
 */
export function StartFinishEditor({ sessionId, track, onRecomputed }: Props) {
  const [points, setPoints] = useState<{ lat: number; lon: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const W = 340;
  const H = 260;

  const bounds = useMemo(() => {
    if (!track || track.lat.length === 0) return null;
    const minLat = Math.min(...track.lat);
    const maxLat = Math.max(...track.lat);
    const minLon = Math.min(...track.lon);
    const maxLon = Math.max(...track.lon);
    const dLat = maxLat - minLat || 1e-6;
    const dLon = maxLon - minLon || 1e-6;
    const latToY = (la: number) => H - 10 - ((la - minLat) / dLat) * (H - 20);
    const lonToX = (lo: number) => 10 + ((lo - minLon) / dLon) * (W - 20);
    const xToLon = (x: number) => minLon + ((x - 10) / (W - 20)) * dLon;
    const yToLat = (y: number) => minLat + ((H - 10 - y) / (H - 20)) * dLat;
    return { latToY, lonToX, xToLon, yToLat };
  }, [track]);

  if (!track || !bounds) {
    return <div className="text-xs text-muted-foreground">No GPS data available.</div>;
  }

  const pathD = track.lat
    .map((la, i) => `${i === 0 ? "M" : "L"} ${bounds.lonToX(track.lon[i]).toFixed(1)} ${bounds.latToY(la).toFixed(1)}`)
    .join(" ");

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!bounds) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lat = bounds.yToLat(y);
    const lon = bounds.xToLon(x);
    setPoints((p) => (p.length >= 2 ? [{ lat, lon }] : [...p, { lat, lon }]));
    setMsg(null);
  }

  async function handleRecompute() {
    if (points.length !== 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await recomputeLapsFromLine(sessionId, {
        lat1: points[0].lat,
        lon1: points[0].lon,
        lat2: points[1].lat,
        lon2: points[1].lon,
      });
      setMsg(`${r.crossings} crossings → ${r.laps.length} laps`);
      onRecomputed();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Click two points on the track outline to define the start/finish line, then recompute laps.
      </p>
      <svg
        width={W}
        height={H}
        onClick={handleClick}
        className="bg-muted/30 rounded cursor-crosshair"
      >
        <path d={pathD} stroke="currentColor" strokeWidth={1.5} fill="none" className="text-muted-foreground" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={bounds.lonToX(p.lon)}
            cy={bounds.latToY(p.lat)}
            r={4}
            fill="hsl(var(--primary))"
          />
        ))}
        {points.length === 2 && (
          <line
            x1={bounds.lonToX(points[0].lon)}
            y1={bounds.latToY(points[0].lat)}
            x2={bounds.lonToX(points[1].lon)}
            y2={bounds.latToY(points[1].lat)}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
          />
        )}
      </svg>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleRecompute} disabled={points.length !== 2 || busy}>
          {busy ? "Recomputing…" : "Recompute laps"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPoints([])} disabled={busy}>
          Clear
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
