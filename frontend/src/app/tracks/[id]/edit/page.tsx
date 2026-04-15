"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchTrackById,
  setTrackSfLine,
  setTrackSplits,
  updateTrack,
  type Track,
  type SfLine,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Mode = "sf" | "split";

export default function TrackEditPage() {
  const params = useParams();
  const id = Number(params.id);

  const [track, setTrack] = useState<Track | null>(null);
  const [mode, setMode] = useState<Mode>("sf");
  const [sfPoints, setSfPoints] = useState<{ lat: number; lon: number }[]>([]);
  const [splits, setSplits] = useState<SfLine[]>([]);
  const [pendingSplit, setPendingSplit] = useState<{ lat: number; lon: number }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchTrackById(id).then((t) => {
      setTrack(t);
      if (t.sf_line) {
        setSfPoints([
          { lat: t.sf_line.lat1, lon: t.sf_line.lon1 },
          { lat: t.sf_line.lat2, lon: t.sf_line.lon2 },
        ]);
      }
      setSplits(t.split_lines ?? []);
    });
  }, [id]);

  const W = 900;
  const H = 620;

  const bounds = useMemo(() => {
    if (!track || !track.gps_outline.length) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [la, lo] of track.gps_outline) {
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo;
      if (lo > maxLon) maxLon = lo;
    }
    const dLat = maxLat - minLat || 1e-6;
    const dLon = maxLon - minLon || 1e-6;
    const pad = 30;
    const scale = Math.min((W - pad * 2) / dLon, (H - pad * 2) / dLat);
    const lonToX = (lo: number) => pad + (lo - minLon) * scale;
    const latToY = (la: number) => H - pad - (la - minLat) * scale;
    const xToLon = (x: number) => minLon + (x - pad) / scale;
    const yToLat = (y: number) => minLat + (H - pad - y) / scale;
    return { lonToX, latToY, xToLon, yToLat };
  }, [track]);

  if (!track || !bounds) {
    return <div className="p-6 text-sm text-muted-foreground">Loading track…</div>;
  }

  const pathD = track.gps_outline
    .map(([la, lo], i) => `${i === 0 ? "M" : "L"} ${bounds.lonToX(lo).toFixed(1)} ${bounds.latToY(la).toFixed(1)}`)
    .join(" ");

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!bounds) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lat = bounds.yToLat(y);
    const lon = bounds.xToLon(x);
    if (mode === "sf") {
      setSfPoints((p) => (p.length >= 2 ? [{ lat, lon }] : [...p, { lat, lon }]));
    } else {
      setPendingSplit((p) => {
        const nxt = [...p, { lat, lon }];
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
    setMsg(null);
  }

  async function saveSf() {
    if (sfPoints.length !== 2) return;
    setBusy(true);
    try {
      await setTrackSfLine(id, {
        lat1: sfPoints[0].lat,
        lon1: sfPoints[0].lon,
        lat2: sfPoints[1].lat,
        lon2: sfPoints[1].lon,
      });
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
            <svg
              width="100%"
              viewBox={`0 0 ${W} ${H}`}
              onClick={handleSvgClick}
              className="bg-[#0c0c0c] rounded cursor-crosshair"
              style={{ maxHeight: 620 }}
            >
              <path d={pathD} stroke="#a3a3a3" strokeWidth={1.5} fill="none" />
              {/* S/F line */}
              {sfPoints.map((p, i) => (
                <circle key={`sf-${i}`} cx={bounds.lonToX(p.lon)} cy={bounds.latToY(p.lat)} r={5} fill="#ef4444" />
              ))}
              {sfPoints.length === 2 && (
                <>
                  <line
                    x1={bounds.lonToX(sfPoints[0].lon)}
                    y1={bounds.latToY(sfPoints[0].lat)}
                    x2={bounds.lonToX(sfPoints[1].lon)}
                    y2={bounds.latToY(sfPoints[1].lat)}
                    stroke="#ef4444"
                    strokeWidth={3}
                  />
                  <text
                    x={(bounds.lonToX(sfPoints[0].lon) + bounds.lonToX(sfPoints[1].lon)) / 2}
                    y={(bounds.latToY(sfPoints[0].lat) + bounds.latToY(sfPoints[1].lat)) / 2 - 6}
                    fill="#ef4444"
                    fontSize={14}
                    textAnchor="middle"
                  >
                    S/F
                  </text>
                </>
              )}
              {/* Splits */}
              {splits.map((s, i) => (
                <g key={`sp-${i}`}>
                  <line
                    x1={bounds.lonToX(s.lon1)}
                    y1={bounds.latToY(s.lat1)}
                    x2={bounds.lonToX(s.lon2)}
                    y2={bounds.latToY(s.lat2)}
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                  />
                  <text
                    x={(bounds.lonToX(s.lon1) + bounds.lonToX(s.lon2)) / 2}
                    y={(bounds.latToY(s.lat1) + bounds.latToY(s.lat2)) / 2 - 6}
                    fill="#22c55e"
                    fontSize={12}
                    textAnchor="middle"
                  >
                    S{i + 1}
                  </text>
                </g>
              ))}
              {/* pending split first point */}
              {pendingSplit.map((p, i) => (
                <circle key={`pp-${i}`} cx={bounds.lonToX(p.lon)} cy={bounds.latToY(p.lat)} r={4} fill="#22c55e" />
              ))}
            </svg>
          </CardContent>
        </Card>

        <div className="space-y-3 text-sm">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2">
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
                  disabled={splits.length >= 8}
                >
                  Add split ({splits.length}/8)
                </Button>
              </div>

              {mode === "sf" ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Click two points on the track to place the S/F line.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveSf} disabled={sfPoints.length !== 2 || busy}>
                      Save S/F
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setSfPoints([])}>
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Click two points to drop a split. Each split = 2 points. Up to 8 splits.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveSplits} disabled={busy}>
                      Save splits
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSplits([]);
                        setPendingSplit([]);
                      }}
                    >
                      Clear all
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
