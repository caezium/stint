"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Circle, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LapTrace } from "./track-map";
import { useUnitsStore, COLORMAP_RAMPS, sampleRamp } from "@/stores/units-store";

// Diverging ramp for signed values (matches canvas TrackMap)
const DIVERGING_RAMP: [number, number, number][] = [
  [59, 130, 246],
  [170, 170, 170],
  [239, 68, 68],
];
function divergingColor(n: number): string {
  return sampleRamp(DIVERGING_RAMP, (Math.max(-1, Math.min(1, n)) + 1) / 2);
}

interface Props {
  traces: LapTrace[];
  cursorMs: number | null;
  setCursorMs?: (ms: number | null) => void;
  sfLine?: { lat1: number; lon1: number; lat2: number; lon2: number } | null;
  splitLines?: { lat1: number; lon1: number; lat2: number; lon2: number }[];
  tileMode: "satellite" | "street";
  width?: number | string;
  height?: number | string;
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  const doneRef = useRef(false);
  useEffect(() => {
    if (!bounds || doneRef.current) return;
    try {
      // fit synchronously with no animation so tiles don't pre-request at default center
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
      // Also invalidate size in case container resized after mount
      setTimeout(() => map.invalidateSize(), 50);
      doneRef.current = true;
    } catch {
      /* ignore */
    }
  }, [map, bounds]);
  return null;
}

function findNearestIndex(timecodes: number[], targetMs: number): number {
  let lo = 0;
  let hi = timecodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timecodes[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const dLo = Math.abs(timecodes[lo] - targetMs);
    const dPrev = Math.abs(timecodes[lo - 1] - targetMs);
    if (dPrev < dLo) return lo - 1;
  }
  return lo;
}

// Click handler that finds the nearest trace point and syncs the cursor
function ClickToCursor({
  traces,
  setCursorMs,
}: {
  traces: LapTrace[];
  setCursorMs?: (ms: number | null) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!setCursorMs) return;
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      const target = traces.find((t) => t.timecodes && t.timecodes.length === t.lat.length);
      if (!target) return;
      const { lat: clat, lng: clon } = e.latlng;
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < target.lat.length; i++) {
        const dLat = target.lat[i] - clat;
        const dLon = target.lon[i] - clon;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      setCursorMs(target.timecodes![bestIdx]);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, traces, setCursorMs]);
  return null;
}

export default function AnalysisLeafletMap({
  traces,
  cursorMs,
  setCursorMs,
  sfLine,
  splitLines = [],
  tileMode,
  width = "100%",
  height = "100%",
}: Props) {
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!traces || traces.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    for (const tr of traces) {
      for (let i = 0; i < tr.lat.length; i++) {
        const la = tr.lat[i];
        const lo = tr.lon[i];
        if (la < minLat) minLat = la;
        if (la > maxLat) maxLat = la;
        if (lo < minLon) minLon = lo;
        if (lo > maxLon) maxLon = lo;
      }
    }
    if (!Number.isFinite(minLat)) return null;
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [traces]);

  const center = useMemo<LatLngExpression>(() => {
    if (!traces || traces.length === 0) return [0, 0];
    const tr = traces[0];
    const midIdx = Math.floor(tr.lat.length / 2);
    return [tr.lat[midIdx], tr.lon[midIdx]];
  }, [traces]);

  // Cursor dots (one per lap with timecodes)
  const cursorDots = useMemo(() => {
    if (cursorMs == null) return [];
    const dots: { lat: number; lon: number; color: string }[] = [];
    for (const tr of traces) {
      if (!tr.timecodes || tr.timecodes.length !== tr.lat.length) continue;
      const idx = findNearestIndex(tr.timecodes, cursorMs);
      if (idx < 0 || idx >= tr.lat.length) continue;
      dots.push({ lat: tr.lat[idx], lon: tr.lon[idx], color: tr.color });
    }
    return dots;
  }, [traces, cursorMs]);

  // Colormap for single-trace value gradient
  const colormap = useUnitsStore((s) => s.colormap);
  const sequentialRamp = COLORMAP_RAMPS[colormap];

  // Render: single trace with values -> per-segment colored; otherwise solid per-lap
  const singleWithValues =
    traces.length === 1 &&
    !!traces[0].values &&
    traces[0].values!.length === traces[0].lat.length;

  const coloredSegments = useMemo(() => {
    if (!singleWithValues) return null;
    const tr = traces[0];
    const vals = tr.values!;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const v of vals) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const signed = minV < 0 && maxV > 0;
    const bound = signed ? Math.max(Math.abs(minV), Math.abs(maxV)) || 1 : 1;
    const range = maxV - minV || 1;
    const segs: { positions: LatLngExpression[]; color: string }[] = [];
    for (let i = 0; i < tr.lat.length - 1; i++) {
      let color: string;
      if (signed) {
        const n = Math.max(-1, Math.min(1, vals[i] / bound));
        color = divergingColor(n);
      } else {
        const f = (vals[i] - minV) / range;
        color = sampleRamp(sequentialRamp, f);
      }
      segs.push({
        positions: [
          [tr.lat[i], tr.lon[i]],
          [tr.lat[i + 1], tr.lon[i + 1]],
        ],
        color,
      });
    }
    return segs;
  }, [singleWithValues, traces, sequentialRamp]);

  const tileUrl =
    tileMode === "satellite"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution =
    tileMode === "satellite"
      ? "Tiles &copy; Esri"
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  return (
    <div style={{ width, height }}>
      <MapContainer
        bounds={bounds ?? undefined}
        boundsOptions={{ padding: [20, 20] }}
        center={bounds ? undefined : center}
        zoom={bounds ? undefined : 15}
        maxZoom={19}
        scrollWheelZoom
        preferCanvas
        style={{ width: "100%", height: "100%", background: "#0c0c0c" }}
      >
        <TileLayer attribution={attribution} url={tileUrl} maxZoom={19} />
        <FitBounds bounds={bounds} />
        <ClickToCursor traces={traces} setCursorMs={setCursorMs} />

        {coloredSegments
          ? coloredSegments.map((s, i) => (
              <Polyline
                key={`seg-${i}`}
                positions={s.positions}
                pathOptions={{ color: s.color, weight: 3, opacity: 0.95 }}
              />
            ))
          : traces.map((tr) => (
              <Polyline
                key={tr.lapNum}
                positions={tr.lat.map((la, i) => [la, tr.lon[i]] as LatLngExpression)}
                pathOptions={{ color: tr.color, weight: 3, opacity: 0.9 }}
              />
            ))}

        {sfLine && (
          <Polyline
            positions={[
              [sfLine.lat1, sfLine.lon1],
              [sfLine.lat2, sfLine.lon2],
            ]}
            pathOptions={{ color: "#ef4444", weight: 4 }}
          />
        )}

        {splitLines.map((s, i) => (
          <Polyline
            key={`split-${i}`}
            positions={[
              [s.lat1, s.lon1],
              [s.lat2, s.lon2],
            ]}
            pathOptions={{ color: "#22c55e", weight: 3, dashArray: "5 3" }}
          />
        ))}

        {cursorDots.map((d, i) => (
          <Circle
            key={`cursor-${i}`}
            center={[d.lat, d.lon]}
            radius={8}
            pathOptions={{
              color: "#ffffff",
              fillColor: d.color,
              fillOpacity: 1,
              weight: 2,
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
