"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  fetchCorners,
  detectCornersForSession,
  fetchTrack,
  setCornerLabel,
  type Corner,
  type TrackData,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCursorStore } from "@/stores/cursor-store";

const TrackMapLeaflet = dynamic(() => import("@/components/track-map-leaflet"), {
  ssr: false,
});

/**
 * Corners panel (Phase 26.1 + v2).
 *
 * Lists detected corners for the session's representative lap with peak g,
 * entry/min/exit speed, and direction. Now augmented with:
 *
 * - A Leaflet map showing each corner as a colored arc (amber → red by
 *   |peak g|) plus an apex dot. Clicking a row or an arc highlights the
 *   other.
 * - Editable corner labels (click the "#" cell to rename).
 * - The clicked corner's apex timestamp is pushed into the cursor store so
 *   navigating to the analysis workspace lands at that moment.
 */
export function CornersPanel({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<Corner[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [activeNum, setActiveNum] = useState<number | null>(null);
  const [editingNum, setEditingNum] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const setCursorMs = useCursorStore((s) => s.setCursorMs);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([fetchCorners(sessionId), fetchTrack(sessionId)]).then(
      ([cornersRes, trackRes]) => {
        if (cornersRes.status === "fulfilled") setRows(cornersRes.value);
        else setRows([]);
        if (trackRes.status === "fulfilled") setTrack(trackRes.value);
        setLoading(false);
      },
    );
  }, [sessionId]);

  async function rerun() {
    setBusy(true);
    try {
      const r = await detectCornersForSession(sessionId);
      setRows(r.corners);
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel(cornerNum: number, label: string) {
    try {
      await setCornerLabel(sessionId, cornerNum, label);
      setRows((prev) =>
        prev.map((c) =>
          c.corner_num === cornerNum ? { ...c, label } : c,
        ),
      );
    } finally {
      setEditingNum(null);
    }
  }

  function handleCornerActivate(cornerNum: number, apexTs: number | null | undefined) {
    setActiveNum(cornerNum);
    // Scroll the corresponding row into view when triggered from the map.
    const el = rowRefs.current[cornerNum];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // Best-effort cursor hint for a downstream analysis workspace visit.
    // The store is persisted, so this survives navigation.
    if (typeof apexTs === "number" && apexTs > 0) {
      setCursorMs(apexTs);
    }
  }

  const outline = useMemo(() => {
    if (!track || track.point_count < 2) return null;
    const pts: number[][] = [];
    for (let i = 0; i < track.point_count; i++) {
      pts.push([track.lat[i], track.lon[i]]);
    }
    return pts;
  }, [track]);

  const mapCorners = useMemo(
    () =>
      rows.map((c) => ({
        corner_num: c.corner_num,
        label: c.label,
        direction: c.direction,
        peak_lat_g: c.peak_lat_g,
        start_lat: c.start_lat ?? null,
        start_lon: c.start_lon ?? null,
        end_lat: c.end_lat ?? null,
        end_lon: c.end_lon ?? null,
        apex_lat: c.apex_lat ?? null,
        apex_lon: c.apex_lon ?? null,
        start_ts_ms: c.start_ts_ms ?? null,
      })),
    [rows],
  );

  if (loading) return null;

  const hasMapData =
    outline && outline.length > 1 && rows.some((r) => r.start_lat != null);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm">Corners</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Detected from the fastest non-pit lap by lateral-g hysteresis. Click a
              corner on the map or in the table to highlight it.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={rerun} disabled={busy}>
            {busy ? "Detecting…" : "Re-detect"}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No corners detected for this session yet.
          </div>
        ) : (
          <>
            {hasMapData && (
              <div className="border-b border-border/40">
                <TrackMapLeaflet
                  outline={outline!}
                  corners={mapCorners}
                  activeCornerNum={activeNum}
                  onCornerClick={(c) =>
                    handleCornerActivate(c.corner_num, c.start_ts_ms ?? null)
                  }
                  height={260}
                />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                      # / Name
                    </th>
                    <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">
                      Dir
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                      Peak g
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                      Entry
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                      Min
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                      Exit
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">
                      Length
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const isActive = c.corner_num === activeNum;
                    const isEditing = c.corner_num === editingNum;
                    return (
                      <tr
                        key={c.corner_num}
                        ref={(el) => {
                          rowRefs.current[c.corner_num] = el;
                        }}
                        className={`border-b border-border/30 cursor-pointer hover:bg-muted/20 ${
                          isActive ? "bg-amber-500/10" : ""
                        }`}
                        onClick={() =>
                          handleCornerActivate(c.corner_num, c.apex_ts_ms ?? null)
                        }
                      >
                        <td className="px-3 py-1.5 font-medium">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={() => saveLabel(c.corner_num, editLabel)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  saveLabel(c.corner_num, editLabel);
                                } else if (e.key === "Escape") {
                                  setEditingNum(null);
                                }
                              }}
                              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs w-32"
                              placeholder={`C${c.corner_num}`}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditLabel(c.label || "");
                                setEditingNum(c.corner_num);
                              }}
                              className="hover:underline text-left"
                              title="Click to rename"
                            >
                              {c.label || `C${c.corner_num}`}
                              {c.label ? (
                                <span className="ml-1.5 text-[10px] text-muted-foreground">
                                  (C{c.corner_num})
                                </span>
                              ) : null}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={
                              c.direction === "right"
                                ? "text-sky-400"
                                : "text-amber-400"
                            }
                          >
                            {c.direction}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {c.peak_lat_g > 0 ? "+" : ""}
                          {c.peak_lat_g.toFixed(2)}g
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {c.entry_speed.toFixed(1)} km/h
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-amber-400">
                          {c.min_speed.toFixed(1)} km/h
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {c.exit_speed.toFixed(1)} km/h
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                          {(c.end_distance_m - c.start_distance_m).toFixed(0)} m
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
