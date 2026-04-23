"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, LayersControl, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface SfLineLL {
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
}

export interface CornerOverlay {
  corner_num: number;
  label?: string | null;
  direction?: "left" | "right";
  peak_lat_g: number;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  apex_lat: number | null;
  apex_lon: number | null;
  start_ts_ms: number | null;
}

export interface TrackMapLeafletProps {
  /** GPS trace: array of [lat, lon] */
  outline: number[][];
  /** Optional per-point values (e.g. speed) — same length as outline — used to color the line */
  speed?: number[] | null;
  /** Solid fallback color when no `speed` provided */
  color?: string;
  /** Optional S/F line overlay */
  sfLine?: SfLineLL | null;
  /** Optional split-line overlays */
  splitLines?: SfLineLL[];
  /** Optional pit-lane polygon as [[lat,lon], ...] (rendered as closed polyline) */
  pitLane?: number[][];
  /** Optional corner arcs overlay — each corner gets a thick colored segment
      between start_lat/lon and end_lat/lon plus an apex dot. Color ramps
      from amber (low-g) to red (high-g). */
  corners?: CornerOverlay[];
  /** Highlight one corner by corner_num (e.g., hover / keyboard focus). */
  activeCornerNum?: number | null;
  /** Click handler for a corner row on the map. */
  onCornerClick?: (c: CornerOverlay) => void;
  /** Called with {lat, lon} of a click on the map; coordinates are real WGS84 */
  onMapClick?: (pt: { lat: number; lon: number }) => void;
  /** Height in px (width fills container) */
  height?: number | string;
  className?: string;
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try {
      map.fitBounds(bounds, { padding: [20, 20] });
    } catch {
      /* ignore */
    }
  }, [map, bounds]);
  return null;
}

function ClickHandler({ onClick }: { onClick?: (pt: { lat: number; lon: number }) => void }) {
  const map = useMap();
  const handlerRef = useRef(onClick);
  handlerRef.current = onClick;
  useEffect(() => {
    if (!map) return;
    const h = (e: { latlng: { lat: number; lng: number } }) => {
      handlerRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng });
    };
    map.on("click", h);
    return () => {
      map.off("click", h);
    };
  }, [map]);
  return null;
}

// Simple viridis-ish ramp for speed coloring.
const SPEED_RAMP: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 144, 141],
  [94, 201, 98],
  [253, 231, 37],
];
function sampleRamp(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  const seg = v * (SPEED_RAMP.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = SPEED_RAMP[i];
  const b = SPEED_RAMP[Math.min(SPEED_RAMP.length - 1, i + 1)];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

// Corner color ramp: amber (moderate g) → orange → red (peak g).
function cornerColor(peakG: number): string {
  const t = Math.max(0, Math.min(1, (Math.abs(peakG) - 0.5) / 1.8));
  const ramp: [number, number, number][] = [
    [251, 191, 36],   // amber-400
    [249, 115, 22],   // orange-500
    [239, 68, 68],    // red-500
  ];
  const seg = t * (ramp.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = ramp[i];
  const b = ramp[Math.min(ramp.length - 1, i + 1)];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

export default function TrackMapLeaflet({
  outline,
  speed,
  color = "#ef4444",
  sfLine,
  splitLines = [],
  pitLane,
  corners = [],
  activeCornerNum = null,
  onCornerClick,
  onMapClick,
  height = 500,
  className,
}: TrackMapLeafletProps) {
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!outline || outline.length === 0) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [la, lo] of outline) {
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo;
      if (lo > maxLon) maxLon = lo;
    }
    if (!Number.isFinite(minLat)) return null;
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [outline]);

  const center = useMemo<LatLngExpression>(() => {
    if (!outline || outline.length === 0) return [0, 0];
    let sla = 0;
    let slo = 0;
    for (const [la, lo] of outline) {
      sla += la;
      slo += lo;
    }
    return [sla / outline.length, slo / outline.length];
  }, [outline]);

  // Speed coloring: split into per-segment polylines.
  const speedSegments = useMemo(() => {
    if (!speed || speed.length !== outline.length || outline.length < 2) return null;
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of speed) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const range = mx - mn || 1;
    const segs: { positions: LatLngExpression[]; color: string }[] = [];
    for (let i = 0; i < outline.length - 1; i++) {
      const t = (speed[i] - mn) / range;
      segs.push({
        positions: [
          [outline[i][0], outline[i][1]],
          [outline[i + 1][0], outline[i + 1][1]],
        ],
        color: sampleRamp(t),
      });
    }
    return segs;
  }, [outline, speed]);

  const solidPositions = useMemo<LatLngExpression[]>(() => {
    return outline.map(([la, lo]) => [la, lo] as LatLngExpression);
  }, [outline]);

  const pitPositions = useMemo<LatLngExpression[] | null>(() => {
    if (!pitLane || pitLane.length < 3) return null;
    const pts = pitLane.map(([la, lo]) => [la, lo] as LatLngExpression);
    pts.push(pts[0]);
    return pts;
  }, [pitLane]);

  return (
    <div className={className} style={{ width: "100%", height }}>
      <MapContainer
        center={center}
        zoom={15}
        maxZoom={19}
        scrollWheelZoom={true}
        style={{ width: "100%", height: "100%" }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds bounds={bounds} />
        <ClickHandler onClick={onMapClick} />

        {speedSegments
          ? speedSegments.map((s, i) => (
              <Polyline
                key={`seg-${i}`}
                positions={s.positions}
                pathOptions={{ color: s.color, weight: 3, opacity: 0.95 }}
              />
            ))
          : solidPositions.length > 1 && (
              <Polyline
                positions={solidPositions}
                pathOptions={{ color, weight: 3, opacity: 0.95 }}
              />
            )}

        {sfLine && (
          <Polyline
            positions={[
              [sfLine.lat1, sfLine.lon1],
              [sfLine.lat2, sfLine.lon2],
            ]}
            pathOptions={{ color: "#ef4444", weight: 5 }}
          />
        )}

        {splitLines.map((s, i) => (
          <Polyline
            key={`split-${i}`}
            positions={[
              [s.lat1, s.lon1],
              [s.lat2, s.lon2],
            ]}
            pathOptions={{ color: "#22c55e", weight: 4, dashArray: "6 3" }}
          />
        ))}

        {pitPositions && (
          <Polyline
            positions={pitPositions}
            pathOptions={{ color: "#f97316", weight: 2, dashArray: "4 2" }}
          />
        )}

        {corners
          .filter(
            (c) =>
              c.start_lat != null &&
              c.start_lon != null &&
              c.end_lat != null &&
              c.end_lon != null,
          )
          .map((c) => {
            const isActive = activeCornerNum === c.corner_num;
            const col = cornerColor(c.peak_lat_g);
            return (
              <Polyline
                key={`corner-${c.corner_num}`}
                positions={[
                  [c.start_lat as number, c.start_lon as number],
                  [c.end_lat as number, c.end_lon as number],
                ]}
                pathOptions={{
                  color: col,
                  weight: isActive ? 9 : 6,
                  opacity: isActive ? 1 : 0.85,
                }}
                eventHandlers={{
                  click: () => onCornerClick?.(c),
                }}
              >
                <Tooltip direction="top" opacity={0.95} sticky>
                  <span style={{ fontSize: 11 }}>
                    {c.label || `C${c.corner_num}`}
                    {" · "}
                    {(c.peak_lat_g > 0 ? "+" : "")}
                    {c.peak_lat_g.toFixed(2)}g · {c.direction}
                  </span>
                </Tooltip>
              </Polyline>
            );
          })}

        {corners
          .filter((c) => c.apex_lat != null && c.apex_lon != null)
          .map((c) => {
            const isActive = activeCornerNum === c.corner_num;
            return (
              <CircleMarker
                key={`apex-${c.corner_num}`}
                center={[c.apex_lat as number, c.apex_lon as number]}
                radius={isActive ? 7 : 4}
                pathOptions={{
                  color: "#111827",
                  weight: 2,
                  fillColor: cornerColor(c.peak_lat_g),
                  fillOpacity: 1,
                }}
                eventHandlers={{
                  click: () => onCornerClick?.(c),
                }}
              />
            );
          })}
      </MapContainer>
    </div>
  );
}
