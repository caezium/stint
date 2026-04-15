"use client";

import { useEffect, useState } from "react";
import { fetchTracks, deleteTrack, type Track } from "@/lib/api";

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);

  function refresh() {
    fetchTracks().then(setTracks).catch(() => setTracks([]));
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="p-6 space-y-4 text-sm">
      <h1 className="text-lg font-semibold">Tracks</h1>
      {tracks.length === 0 && (
        <p className="text-muted-foreground">
          No tracks yet. Tracks are created from session GPS data.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tracks.map((t) => (
          <div key={t.id} className="rounded border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <b>{t.name}</b>
              <button
                onClick={async () => {
                  await deleteTrack(t.id);
                  refresh();
                }}
                className="text-xs text-muted-foreground hover:text-red-400"
              >
                Delete
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t.country || "—"} · {t.length_m ? `${t.length_m.toFixed(0)} m` : "length unknown"}
            </div>
            <TrackOutline points={t.gps_outline} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackOutline({ points }: { points: number[][] }) {
  if (!points || points.length < 2) {
    return <div className="h-32 rounded bg-muted/30 text-xs flex items-center justify-center text-muted-foreground">no outline</div>;
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const w = 200, h = 120, pad = 8;
  const rLat = (maxLat - minLat) || 1e-6;
  const rLon = (maxLon - minLon) || 1e-6;
  const scale = Math.min((w - 2 * pad) / rLon, (h - 2 * pad) / rLat);
  const d = points
    .map(([lat, lon], i) => {
      const x = pad + (lon - minLon) * scale;
      const y = pad + (maxLat - lat) * scale;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="rounded bg-[#0c0c0c]">
      <path d={d} fill="none" stroke="#ef4444" strokeWidth={1.5} />
    </svg>
  );
}
