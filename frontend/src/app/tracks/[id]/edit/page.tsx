"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  fetchTrackById,
  fetchTracks,
  setTrackSfLine,
  setTrackSplits,
  setTrackPitLane,
  clearTrackSfLine,
  clearTrackPitLane,
  clearTrackSplits,
  copySplitsFromTrack,
  updateTrack,
  type Track,
  type SfLine,
  type Split,
  type SplitType,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const TrackMapLeaflet = dynamic(() => import("@/components/track-map-leaflet"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] bg-[#0c0c0c] rounded flex items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

type Mode = "sf" | "split" | "pit";
type PlaceMode = "1click" | "2click";
type LatLon = { lat: number; lon: number };

// Half-width of an auto-placed S/F or split line, in meters.
const AUTO_HALF_WIDTH_M = 15;

function metersToLatLonOffset(
  lat: number,
  dxMeters: number,
  dyMeters: number
): { dLat: number; dLon: number } {
  const dLat = dyMeters / 111320;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = dxMeters / (111320 * cosLat);
  return { dLat, dLon };
}

function findNearestOutlineIndex(outline: number[][], lat: number, lon: number): number {
  if (!outline || outline.length === 0) return -1;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const dLat = outline[i][0] - lat;
    const dLon = (outline[i][1] - lon) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function perpendicularLineAt(
  outline: number[][],
  idx: number,
  halfWidthM: number
): SfLine | null {
  const n = outline.length;
  if (n < 2 || idx < 0) return null;
  // Handle wrap-around: previous and next neighbours.
  const prev = outline[(idx - 1 + n) % n];
  const next = outline[(idx + 1) % n];
  const center = outline[idx];
  const lat = center[0];
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  // Tangent in local meters.
  const tx = (next[1] - prev[1]) * 111320 * cosLat;
  const ty = (next[0] - prev[0]) * 111320;
  const len = Math.hypot(tx, ty);
  if (len === 0) return null;
  const ux = tx / len;
  const uy = ty / len;
  // 90° rotation: (ux, uy) -> (-uy, ux)
  const px = -uy;
  const py = ux;
  // Endpoint offsets in meters.
  const dx1 = px * halfWidthM;
  const dy1 = py * halfWidthM;
  const { dLat: dLat1, dLon: dLon1 } = metersToLatLonOffset(lat, dx1, dy1);
  const lat1 = center[0] + dLat1;
  const lon1 = center[1] + dLon1;
  const lat2 = center[0] - dLat1;
  const lon2 = center[1] - dLon1;
  return { lat1, lon1, lat2, lon2 };
}

export default function TrackEditPage() {
  const params = useParams();
  const id = Number(params.id);

  const [track, setTrack] = useState<Track | null>(null);
  const [mode, setMode] = useState<Mode>("sf");
  const [placeMode, setPlaceMode] = useState<PlaceMode>("1click");
  const [sfClickBuf, setSfClickBuf] = useState<LatLon[]>([]);
  const [sfLine, setSfLine] = useState<SfLine | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [pendingSplit, setPendingSplit] = useState<LatLon[]>([]);
  const [pitLane, setPitLane] = useState<LatLon[]>([]);
  const [pitClosed, setPitClosed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [copySourceId, setCopySourceId] = useState<number | "">("");

  useEffect(() => {
    if (!id) return;
    fetchTrackById(id).then((t) => {
      setTrack(t);
      if (t.sf_line) {
        setSfLine(t.sf_line);
        setSfClickBuf([
          { lat: t.sf_line.lat1, lon: t.sf_line.lon1 },
          { lat: t.sf_line.lat2, lon: t.sf_line.lon2 },
        ]);
      }
      setSplits(t.split_lines ?? []);
      if (Array.isArray(t.pit_lane) && t.pit_lane.length >= 3) {
        setPitLane(t.pit_lane.map((v) => ({ lat: v[0], lon: v[1] })));
        setPitClosed(true);
      }
    });
    fetchTracks().then(setAllTracks).catch(() => setAllTracks([]));
  }, [id]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (mode !== "pit") return;
      if (ev.key === "Enter" && pitLane.length >= 3) {
        setPitClosed(true);
        ev.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, pitLane.length]);

  if (!track) {
    return <div className="p-6 text-sm text-muted-foreground">Loading track…</div>;
  }

  function handleMapClick(pt: { lat: number; lon: number }) {
    if (!track) return;
    const outline = track.gps_outline;
    if (mode === "sf") {
      if (placeMode === "1click") {
        const idx = findNearestOutlineIndex(outline, pt.lat, pt.lon);
        const line = perpendicularLineAt(outline, idx, AUTO_HALF_WIDTH_M);
        if (line) {
          setSfLine(line);
          setSfClickBuf([
            { lat: line.lat1, lon: line.lon1 },
            { lat: line.lat2, lon: line.lon2 },
          ]);
        }
      } else {
        setSfClickBuf((p) => {
          const nxt = p.length >= 2 ? [{ lat: pt.lat, lon: pt.lon }] : [...p, { lat: pt.lat, lon: pt.lon }];
          if (nxt.length === 2) {
            setSfLine({ lat1: nxt[0].lat, lon1: nxt[0].lon, lat2: nxt[1].lat, lon2: nxt[1].lon });
          } else {
            setSfLine(null);
          }
          return nxt;
        });
      }
    } else if (mode === "split") {
      if (splits.length >= 8) return;
      if (placeMode === "1click") {
        const idx = findNearestOutlineIndex(outline, pt.lat, pt.lon);
        const line = perpendicularLineAt(outline, idx, AUTO_HALF_WIDTH_M);
        if (line) {
          setSplits((s) => [...s, line]);
        }
      } else {
        setPendingSplit((p) => {
          const nxt = [...p, { lat: pt.lat, lon: pt.lon }];
          if (nxt.length === 2) {
            setSplits((s) => [
              ...s,
              { lat1: nxt[0].lat, lon1: nxt[0].lon, lat2: nxt[1].lat, lon2: nxt[1].lon },
            ]);
            return [];
          }
          return nxt;
        });
      }
    } else {
      setPitClosed(false);
      setPitLane((p) => [...p, { lat: pt.lat, lon: pt.lon }]);
    }
    setMsg(null);
  }

  async function savePitLane() {
    if (pitLane.length < 3) {
      setMsg("Need at least 3 vertices");
      return;
    }
    setBusy(true);
    try {
      await setTrackPitLane(id, pitLane);
      setPitClosed(true);
      setMsg(`Saved pit lane (${pitLane.length} vertices)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSf() {
    if (!sfLine) return;
    setBusy(true);
    try {
      await setTrackSfLine(id, sfLine);
      setMsg("S/F line saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSplits() {
    setBusy(true);
    try {
      await setTrackSplits(id, splits);
      setMsg(`Saved ${splits.length} splits`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    if (!track) return;
    setBusy(true);
    try {
      await updateTrack(id, {
        name: track.name,
        country: track.country,
        length_m: track.length_m,
        gps_outline: track.gps_outline,
        sector_defs: track.sector_defs,
        short_name: track.short_name ?? "",
        city: track.city ?? "",
        type: track.type ?? "",
        surface: track.surface ?? "",
        timezone: track.timezone ?? "",
        sf_line: track.sf_line ?? null,
        split_lines: track.split_lines ?? [],
        pit_lane: track.pit_lane ?? [],
      });
      setMsg("Metadata saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const pitPolygonLL = pitClosed && pitLane.length >= 3 ? pitLane.map((p) => [p.lat, p.lon]) : undefined;

  return (
    <div className="max-w-[1200px] mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/tracks" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Tracks
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Edit {track.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Card>
          <CardContent className="p-2">
            <TrackMapLeaflet
              outline={track.gps_outline}
              sfLine={sfLine}
              splitLines={splits}
              pitLane={pitPolygonLL}
              onMapClick={handleMapClick}
              height={620}
            />
            {pendingSplit.length === 1 && placeMode === "2click" && (
              <p className="text-xs text-muted-foreground px-2 pt-2">
                Split: click second point to complete.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3 text-sm">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={mode === "sf" ? "default" : "secondary"}
                  onClick={() => setMode("sf")}
                >
                  S/F line
                </Button>
                <Button
                  size="sm"
                  variant={mode === "split" ? "default" : "secondary"}
                  onClick={() => setMode("split")}
                >
                  Splits ({splits.length}/8)
                </Button>
                <Button
                  size="sm"
                  variant={mode === "pit" ? "default" : "secondary"}
                  onClick={() => setMode("pit")}
                >
                  Pit lane
                </Button>
              </div>

              {mode !== "pit" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Placement:</span>
                  <Button
                    size="sm"
                    variant={placeMode === "1click" ? "default" : "secondary"}
                    onClick={() => {
                      setPlaceMode("1click");
                      setPendingSplit([]);
                    }}
                  >
                    1-click perpendicular
                  </Button>
                  <Button
                    size="sm"
                    variant={placeMode === "2click" ? "default" : "secondary"}
                    onClick={() => setPlaceMode("2click")}
                  >
                    2-click
                  </Button>
                </div>
              )}

              {mode === "sf" ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {placeMode === "1click"
                      ? "Click once on the track — a perpendicular S/F line is placed for you."
                      : "Click two points on the track to place the S/F line."}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" onClick={saveSf} disabled={!sfLine || busy}>
                      Save S/F
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || (!sfLine && sfClickBuf.length === 0)}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await clearTrackSfLine(id);
                          setSfClickBuf([]);
                          setSfLine(null);
                          setMsg("S/F line cleared");
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete S/F
                    </Button>
                  </div>
                </div>
              ) : mode === "split" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {placeMode === "1click"
                      ? "Click once per split — each is auto-perpendicular to the track. Up to 8."
                      : "Click two points per split. Up to 8 splits."}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" onClick={saveSplits} disabled={busy}>
                      Save splits
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || splits.length === 0}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await clearTrackSplits(id);
                          setSplits([]);
                          setPendingSplit([]);
                          setMsg("All splits cleared");
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete all
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSplits((s) => s.slice(0, -1))}
                      disabled={splits.length === 0}
                    >
                      Undo
                    </Button>
                  </div>

                  {/* Splits list — Phase 24.1 */}
                  {splits.length > 0 && (
                    <div className="space-y-1.5 border-t border-border/40 pt-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Splits ({splits.length})
                      </div>
                      {splits.map((s, idx) => (
                        <SplitRow
                          key={idx}
                          idx={idx}
                          split={s}
                          total={splits.length}
                          onChange={(patch) =>
                            setSplits((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)),
                            )
                          }
                          onDelete={() =>
                            setSplits((prev) => prev.filter((_, i) => i !== idx))
                          }
                          onMoveUp={
                            idx > 0
                              ? () =>
                                  setSplits((prev) => {
                                    const n = [...prev];
                                    [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                                    return n;
                                  })
                              : undefined
                          }
                          onMoveDown={
                            idx < splits.length - 1
                              ? () =>
                                  setSplits((prev) => {
                                    const n = [...prev];
                                    [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
                                    return n;
                                  })
                              : undefined
                          }
                          onMergePrev={
                            idx > 0
                              ? () =>
                                  setSplits((prev) => {
                                    const merged = midpointSplit(prev[idx - 1], prev[idx]);
                                    return [
                                      ...prev.slice(0, idx - 1),
                                      merged,
                                      ...prev.slice(idx + 1),
                                    ];
                                  })
                              : undefined
                          }
                          onMergeNext={
                            idx < splits.length - 1
                              ? () =>
                                  setSplits((prev) => {
                                    const merged = midpointSplit(prev[idx], prev[idx + 1]);
                                    return [
                                      ...prev.slice(0, idx),
                                      merged,
                                      ...prev.slice(idx + 2),
                                    ];
                                  })
                              : undefined
                          }
                          onDivide={
                            track
                              ? () =>
                                  setSplits((prev) => {
                                    const pair = divideSplitAtMidpoint(prev[idx], track.gps_outline);
                                    if (!pair) return prev;
                                    return [
                                      ...prev.slice(0, idx),
                                      pair[0],
                                      pair[1],
                                      ...prev.slice(idx + 1),
                                    ];
                                  })
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* Copy splits from another track — Phase 24.2 */}
                  <div className="border-t border-border/40 pt-2 space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Copy splits from another track
                    </div>
                    <div className="flex gap-2">
                      <select
                        className="flex-1 min-w-0 bg-background border border-input rounded-md px-2 py-1 text-sm"
                        value={copySourceId}
                        onChange={(e) =>
                          setCopySourceId(e.target.value ? Number(e.target.value) : "")
                        }
                      >
                        <option value="">Select a track…</option>
                        {allTracks
                          .filter((t) => t.id !== id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.city ? ` · ${t.city}` : ""}
                            </option>
                          ))}
                      </select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || copySourceId === ""}
                        onClick={async () => {
                          if (copySourceId === "") return;
                          if (
                            splits.length > 0 &&
                            !confirm(
                              `Replace the current ${splits.length} split(s) with the splits from the selected track?`,
                            )
                          )
                            return;
                          setBusy(true);
                          try {
                            const r = await copySplitsFromTrack(id, copySourceId as number);
                            const t = await fetchTrackById(id);
                            setSplits(t.split_lines ?? []);
                            setMsg(
                              `Copied ${r.split_count} split(s)` +
                                (r.recomputed_sessions
                                  ? ` · ${r.recomputed_sessions} bound session${r.recomputed_sessions === 1 ? "" : "s"} recomputed`
                                  : ""),
                            );
                          } catch (e) {
                            setMsg(e instanceof Error ? e.message : "Failed");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Click to add polygon vertices. Press Enter to close. Save to persist.
                  </p>
                  <div className="text-xs text-muted-foreground">
                    Vertices: {pitLane.length} {pitClosed ? "(closed)" : ""}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={savePitLane} disabled={busy || pitLane.length < 3}>
                      Save pit lane
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || pitLane.length === 0}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await clearTrackPitLane(id);
                          setPitLane([]);
                          setPitClosed(false);
                          setMsg("Pit lane cleared");
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete pit lane
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPitLane((p) => p.slice(0, -1));
                        setPitClosed(false);
                      }}
                      disabled={pitLane.length === 0}
                    >
                      Undo
                    </Button>
                    {pitLane.length >= 3 && !pitClosed && (
                      <Button size="sm" variant="secondary" onClick={() => setPitClosed(true)}>
                        Close polygon
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <h3 className="font-semibold text-sm">Metadata</h3>
              <Input
                placeholder="Name"
                value={track.name}
                onChange={(e) => setTrack({ ...track, name: e.target.value })}
              />
              <Input
                placeholder="Short name"
                value={track.short_name ?? ""}
                onChange={(e) => setTrack({ ...track, short_name: e.target.value })}
              />
              <Input
                placeholder="Country"
                value={track.country}
                onChange={(e) => setTrack({ ...track, country: e.target.value })}
              />
              <Input
                placeholder="City"
                value={track.city ?? ""}
                onChange={(e) => setTrack({ ...track, city: e.target.value })}
              />
              <Input
                placeholder="Type (oval / road / street)"
                value={track.type ?? ""}
                onChange={(e) => setTrack({ ...track, type: e.target.value })}
              />
              <Input
                placeholder="Surface"
                value={track.surface ?? ""}
                onChange={(e) => setTrack({ ...track, surface: e.target.value })}
              />
              <Input
                placeholder="Timezone"
                value={track.timezone ?? ""}
                onChange={(e) => setTrack({ ...track, timezone: e.target.value })}
              />
              <Button size="sm" onClick={saveMeta} disabled={busy}>
                Save metadata
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 24.1 — Splits management helpers & row editor
// ---------------------------------------------------------------------------

const SPLIT_TYPES: { value: SplitType; label: string }[] = [
  { value: "", label: "—" },
  { value: "corner1", label: "Corner 1" },
  { value: "corner2", label: "Corner 2" },
  { value: "straight", label: "Straight" },
  { value: "chicane", label: "Chicane" },
];

function midpointSplit(a: Split, b: Split): Split {
  return {
    lat1: (a.lat1 + b.lat1) / 2,
    lon1: (a.lon1 + b.lon1) / 2,
    lat2: (a.lat2 + b.lat2) / 2,
    lon2: (a.lon2 + b.lon2) / 2,
    label: a.label || b.label || "",
    type: a.type || b.type || "",
  };
}

/** Produce two splits from one, placed at 25% and 75% along the original
 * geometry. Rough but useful for "divide at cursor" in lieu of an actual
 * on-map cursor anchor (which would require the map component to expose it). */
function divideSplitAtMidpoint(
  s: Split,
  outline: number[][],
): [Split, Split] | null {
  // Shift each endpoint halfway along the line in opposite directions to
  // produce two non-overlapping splits flanking the centre.
  const cx = (s.lat1 + s.lat2) / 2;
  const cy = (s.lon1 + s.lon2) / 2;
  const dLat = (s.lat2 - s.lat1) / 2;
  const dLon = (s.lon2 - s.lon1) / 2;
  // Shift one copy 25% "up", one 25% "down" along the line direction by
  // offsetting the midpoint along a small tangent found from the outline.
  const nearest = findNearestOutlineIndex(outline, cx, cy);
  const tangent =
    outline.length > 2 && nearest >= 0
      ? [
          outline[(nearest + 1) % outline.length][0] -
            outline[(nearest - 1 + outline.length) % outline.length][0],
          outline[(nearest + 1) % outline.length][1] -
            outline[(nearest - 1 + outline.length) % outline.length][1],
        ]
      : null;
  const tLen = tangent ? Math.hypot(tangent[0], tangent[1]) : 0;
  const offsetLat = tangent && tLen > 0 ? (tangent[0] / tLen) * Math.abs(dLat) : 0;
  const offsetLon = tangent && tLen > 0 ? (tangent[1] / tLen) * Math.abs(dLon) : 0;
  const labelPrefix = s.label || "";
  return [
    {
      lat1: s.lat1 - offsetLat * 0.5,
      lon1: s.lon1 - offsetLon * 0.5,
      lat2: s.lat2 - offsetLat * 0.5,
      lon2: s.lon2 - offsetLon * 0.5,
      label: labelPrefix ? `${labelPrefix} a` : "",
      type: s.type || "",
    },
    {
      lat1: s.lat1 + offsetLat * 0.5,
      lon1: s.lon1 + offsetLon * 0.5,
      lat2: s.lat2 + offsetLat * 0.5,
      lon2: s.lon2 + offsetLon * 0.5,
      label: labelPrefix ? `${labelPrefix} b` : "",
      type: s.type || "",
    },
  ];
}

interface SplitRowProps {
  idx: number;
  split: Split;
  total: number;
  onChange: (patch: Partial<Split>) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMergePrev?: () => void;
  onMergeNext?: () => void;
  onDivide?: () => void;
}

function SplitRow({
  idx,
  split,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMergePrev,
  onMergeNext,
  onDivide,
}: SplitRowProps) {
  return (
    <div className="border border-border/40 rounded-md p-2 space-y-1.5 bg-muted/10">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-mono text-muted-foreground w-6 shrink-0">
          #{idx + 1}
        </span>
        <Input
          className="h-7 text-xs"
          placeholder="Label (e.g. Hairpin)"
          value={split.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select
          className="bg-background border border-input rounded-md px-1.5 py-1 text-xs h-7"
          value={split.type ?? ""}
          onChange={(e) => onChange({ type: e.target.value as SplitType })}
          title="Split type"
        >
          {SPLIT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        <SplitActionBtn onClick={onMoveUp} disabled={!onMoveUp} title="Move up">
          ↑
        </SplitActionBtn>
        <SplitActionBtn onClick={onMoveDown} disabled={!onMoveDown} title="Move down">
          ↓
        </SplitActionBtn>
        <SplitActionBtn
          onClick={onMergePrev}
          disabled={!onMergePrev}
          title="Merge with previous"
        >
          ⌂-
        </SplitActionBtn>
        <SplitActionBtn
          onClick={onMergeNext}
          disabled={!onMergeNext}
          title="Merge with next"
        >
          +⌂
        </SplitActionBtn>
        <SplitActionBtn onClick={onDivide} disabled={!onDivide} title="Divide into two">
          ÷
        </SplitActionBtn>
        <SplitActionBtn
          onClick={onDelete}
          className="text-red-400 hover:text-red-300"
          title="Delete"
        >
          ×
        </SplitActionBtn>
      </div>
    </div>
  );
}

function SplitActionBtn({
  children,
  onClick,
  disabled,
  className,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-xs px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
