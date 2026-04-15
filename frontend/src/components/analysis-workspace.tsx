"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useSessionStore } from "@/stores/session-store";
import { useLapStore } from "@/stores/lap-store";
import { useCursorStore } from "@/stores/cursor-store";
import { fetchTrack, fetchTrackOverlay, fetchMathDefaults, type TrackData, type TrackOverlayData } from "@/lib/api";
import { TelemetryChart } from "@/components/charts/telemetry-chart";
import { DeltaChart } from "@/components/charts/delta-chart";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { LapTimeChart } from "@/components/charts/lap-time-chart";
import { FFTChart } from "@/components/charts/fft-chart";
import { PredictiveChart } from "@/components/charts/predictive-chart";
import { SuspensionChart } from "@/components/charts/suspension-chart";
import { LapSelector } from "@/components/lap-selector";
import { ChannelBrowser } from "@/components/channel-browser";
import { TrackMap, type LapTrace } from "@/components/track-map";
import { StatsPanel } from "@/components/stats-panel";
import { SectorAnalysis } from "@/components/sector-analysis";
import { MathChannelEditor } from "@/components/math-channel-editor";
import { LayoutManager } from "@/components/layout-manager";
import { SessionNotes } from "@/components/session-notes";
import { UnitSettings } from "@/components/unit-settings";
import { KeyboardHelp } from "@/components/keyboard-help";
import {
  useUnitsStore,
  isSpeedUnits,
  convertSpeed,
  SPEED_UNIT_LABEL,
  isTemperatureUnits,
  convertTemperature,
  TEMP_UNIT_LABEL,
  isDistanceUnits,
  convertDistance,
  DISTANCE_UNIT_LABEL,
  isAngularUnits,
  convertAngular,
  ANGULAR_UNIT_LABEL,
} from "@/stores/units-store";
import { getExportCsvUrl, getExportPdfUrl } from "@/lib/api";

// ---- Chart config types ----

type ChartType =
  | "telemetry"
  | "delta"
  | "histogram"
  | "scatter"
  | "laptime"
  | "sector"
  | "stats"
  | "fft"
  | "predictive"
  | "suspension";

interface ChartConfig {
  id: string;
  type: ChartType;
  channels: string[];
  options?: Record<string, unknown>;
}

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  telemetry: "Telemetry",
  delta: "Delta-T",
  histogram: "Histogram",
  scatter: "Scatter (XY)",
  laptime: "Lap Times",
  sector: "Sector Table",
  stats: "Statistics",
  fft: "FFT Spectrum",
  predictive: "Predictive",
  suspension: "Suspension",
};

function defaultCharts(): ChartConfig[] {
  return [
    { id: "chart-1", type: "telemetry", channels: ["GPS Speed"] },
    { id: "chart-2", type: "telemetry", channels: ["RPM"] },
  ];
}

// ---- Main component ----

export function AnalysisWorkspace({ sessionId }: { sessionId: string }) {
  const session = useSessionStore((s) => s.session);
  const { refLap, altLap, extraLaps, crossSessionLaps } = useLapStore();
  const { xAxisMode, setXAxisMode, zoomRange, setZoomRange } = useCursorStore();
  const [track, setTrack] = useState<TrackData | null>(null);
  // Keyed by `${sessionId}:${lapNum}` to support cross-session laps
  const [lapTracks, setLapTracks] = useState<Map<string, TrackData>>(new Map());
  const [trackOverlay, setTrackOverlay] = useState<TrackOverlayData | null>(null);
  const [trackColorChannel, setTrackColorChannel] = useState("speed");
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [showMathEditor, setShowMathEditor] = useState(false);
  const loadSession = useSessionStore((s) => s.loadSession);

  const [charts, setCharts] = useState<ChartConfig[]>(() => {
    if (typeof window === "undefined") return defaultCharts();
    try {
      const saved = localStorage.getItem(`stint-charts-${sessionId}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultCharts();
  });

  // Persist charts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`stint-charts-${sessionId}`, JSON.stringify(charts));
    } catch {}
  }, [charts, sessionId]);

  // Persist x-axis mode
  useEffect(() => {
    try {
      localStorage.setItem("stint-xaxis-mode", xAxisMode);
    } catch {}
  }, [xAxisMode]);

  // Restore x-axis mode on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("stint-xaxis-mode");
      if (saved === "time" || saved === "distance") setXAxisMode(saved);
    } catch {}
  }, []);

  // Fetch track data (best lap fallback)
  useEffect(() => {
    fetchTrack(sessionId).then(setTrack).catch(() => null);
  }, [sessionId]);

  // Prewarm default math channels cache for the current ref lap
  useEffect(() => {
    if (!refLap) return;
    fetchMathDefaults(sessionId, refLap.num).catch(() => null);
  }, [sessionId, refLap]);

  // Fetch per-lap tracks for all active laps (including cross-session)
  interface ActiveLapSource {
    sessionId: string;
    lap: { num: number; start_time_ms: number; end_time_ms: number; duration_ms: number };
    key: string;
    label: string;
  }

  const activeLapsForMap = useMemo<ActiveLapSource[]>(() => {
    const out: ActiveLapSource[] = [];
    const add = (sid: string, lap: ActiveLapSource["lap"], label: string) => {
      const key = `${sid}:${lap.num}`;
      if (out.some((s) => s.key === key)) return;
      out.push({ sessionId: sid, lap, key, label });
    };
    if (refLap) add(sessionId, refLap, `L${refLap.num}`);
    if (altLap) add(sessionId, altLap, `L${altLap.num}`);
    for (const l of extraLaps) add(sessionId, l, `L${l.num}`);
    for (const e of crossSessionLaps)
      add(e.sessionId, e.lap, `L${e.lap.num} @${e.sessionLabel.slice(0, 15)}`);
    return out;
  }, [sessionId, refLap, altLap, extraLaps, crossSessionLaps]);

  useEffect(() => {
    let cancelled = false;
    const needed = activeLapsForMap.filter((s) => !lapTracks.has(s.key));
    if (needed.length === 0) return;
    Promise.all(
      needed.map((s) =>
        fetchTrack(s.sessionId, s.lap.num)
          .then((d) => ({ key: s.key, data: d }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setLapTracks((prev) => {
        const next = new Map(prev);
        for (const r of results) if (r) next.set(r.key, r.data);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [sessionId, activeLapsForMap, lapTracks]);

  // Fetch track overlay when color channel changes
  useEffect(() => {
    if (trackColorChannel === "speed") {
      setTrackOverlay(null);
      return;
    }
    fetchTrackOverlay(sessionId, trackColorChannel, refLap?.num)
      .then(setTrackOverlay)
      .catch(() => setTrackOverlay(null));
  }, [sessionId, trackColorChannel, refLap]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case "Escape":
          // Reset zoom
          setZoomRange(null);
          break;
        case "ArrowLeft":
          // Step cursor backward
          useCursorStore.setState((s) => ({
            cursorMs: Math.max(0, (s.cursorMs ?? 0) - (e.shiftKey ? 500 : 50)),
          }));
          e.preventDefault();
          break;
        case "ArrowRight":
          // Step cursor forward
          useCursorStore.setState((s) => ({
            cursorMs: (s.cursorMs ?? 0) + (e.shiftKey ? 500 : 50),
          }));
          e.preventDefault();
          break;
        case "t":
          if (!e.metaKey && !e.ctrlKey) setXAxisMode("time");
          break;
        case "d":
          if (!e.metaKey && !e.ctrlKey) setXAxisMode("distance");
          break;
        default:
          // 1-9 to toggle laps
          if (/^[1-9]$/.test(e.key) && session) {
            const lapNum = parseInt(e.key);
            const lap = session.laps.find((l) => l.num === lapNum);
            if (lap) {
              if (e.shiftKey) {
                // Shift+number: toggle extra lap
                useLapStore.getState().toggleExtraLap(lap);
              } else {
                useLapStore.getState().setRefLap(lap);
              }
            }
          }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, setZoomRange, setXAxisMode]);

  const allActiveChannels = useMemo(
    () => charts.flatMap((c) => c.channels),
    [charts]
  );

  const chartHeight = Math.max(
    200,
    Math.floor(700 / Math.max(charts.length, 1)) - 30
  );

  // ---- Channel toggle (from browser click) ----
  const handleToggleChannel = useCallback(
    (name: string) => {
      const existing = charts.find((c) => c.channels.includes(name));
      if (existing) {
        setCharts((prev) =>
          prev
            .map((c) =>
              c.id === existing.id
                ? { ...c, channels: c.channels.filter((ch) => ch !== name) }
                : c
            )
            .filter((c) => c.channels.length > 0 || c.type !== "telemetry")
        );
        return;
      }
      // Add to last telemetry chart, or create new
      setCharts((prev) => {
        const telCharts = prev.filter((c) => c.type === "telemetry");
        const last = telCharts[telCharts.length - 1];
        if (last && last.channels.length < 3) {
          return prev.map((c) =>
            c.id === last.id
              ? { ...c, channels: [...c.channels, name] }
              : c
          );
        }
        return [
          ...prev,
          { id: `chart-${Date.now()}`, type: "telemetry" as ChartType, channels: [name] },
        ];
      });
    },
    [charts]
  );

  // ---- Drop channel onto specific chart ----
  const handleDropChannel = useCallback(
    (chartId: string, channelName: string) => {
      setCharts((prev) =>
        prev.map((c) => {
          if (c.id !== chartId) return c;
          if (c.channels.includes(channelName)) return c;
          return { ...c, channels: [...c.channels, channelName] };
        })
      );
    },
    []
  );

  // ---- Add chart ----
  const handleAddChart = useCallback(
    (type: ChartType) => {
      const id = `chart-${Date.now()}`;
      const defaultChannels = type === "telemetry" ? ["GPS Speed"] : [];
      setCharts((prev) => [
        ...prev,
        { id, type, channels: defaultChannels },
      ]);
      setAddChartOpen(false);
    },
    []
  );

  // ---- Remove chart ----
  const handleRemoveChart = useCallback((chartId: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== chartId));
  }, []);

  // ---- Layout load ----
  const handleLoadLayout = useCallback((config: object) => {
    if (Array.isArray((config as { charts?: unknown }).charts)) {
      setCharts((config as { charts: ChartConfig[] }).charts);
    }
  }, []);

  // ---- CSV export ----
  const handleExportCsv = useCallback(() => {
    if (!refLap) return;
    const allCh = charts.flatMap((c) => c.channels).filter(Boolean);
    if (allCh.length === 0) return;
    const url = getExportCsvUrl(sessionId, allCh, refLap.num);
    window.open(url, "_blank");
  }, [charts, sessionId, refLap]);

  // ---- Drag reorder ----
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      setDragIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
    },
    []
  );

  const handleDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const handleDrop = useCallback(
    (targetIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromStr = e.dataTransfer.getData("text/plain");
      // Check if it's a channel name (from channel browser)
      if (fromStr && isNaN(Number(fromStr))) {
        // It's a channel name being dropped onto a chart
        handleDropChannel(charts[targetIdx]?.id, fromStr);
        return;
      }
      const fromIdx = Number(fromStr);
      if (isNaN(fromIdx) || fromIdx === targetIdx) return;
      setCharts((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
      setDragIdx(null);
    },
    [charts, handleDropChannel]
  );

  if (!session) return null;

  const TRACK_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f97316", "#a855f7", "#06b6d4", "#eab308", "#ec4899"];

  // Build per-lap traces. Single lap → use overlay/speed gradient. Multi-lap → colored lines.
  const mapLapTraces: LapTrace[] = useMemo(() => {
    const traces: LapTrace[] = [];
    for (let i = 0; i < activeLapsForMap.length; i++) {
      const s = activeLapsForMap[i];
      const td = lapTracks.get(s.key);
      if (!td) continue;
      traces.push({
        lapNum: s.lap.num,
        lat: td.lat,
        lon: td.lon,
        timecodes: td.timecodes ?? undefined,
        values: td.speed ?? undefined,
        color: TRACK_COLORS[i % TRACK_COLORS.length],
        label: s.label,
      });
    }
    return traces;
  }, [activeLapsForMap, lapTracks]);

  // Fallback when no active lap is selected yet
  const singleFallback: LapTrace[] = useMemo(() => {
    if (mapLapTraces.length > 0) return [];
    const lat = trackOverlay?.lat ?? track?.lat ?? [];
    const lon = trackOverlay?.lon ?? track?.lon ?? [];
    if (lat.length < 2) return [];
    return [
      {
        lapNum: 0,
        lat,
        lon,
        timecodes: track?.timecodes ?? undefined,
        values: trackOverlay?.values ?? track?.speed ?? undefined,
        color: TRACK_COLORS[0],
        label: "Best",
      },
    ];
  }, [mapLapTraces.length, trackOverlay, track]);

  // If overlay is active (non-speed channel) and a single ref lap is selected,
  // use the overlay values on the ref trace
  const finalMapTraces: LapTrace[] = useMemo(() => {
    const base = mapLapTraces.length > 0 ? mapLapTraces : singleFallback;
    if (trackOverlay && trackColorChannel !== "speed" && base.length === 1) {
      return [{ ...base[0], values: trackOverlay.values ?? undefined, lat: trackOverlay.lat, lon: trackOverlay.lon }];
    }
    return base;
  }, [mapLapTraces, singleFallback, trackOverlay, trackColorChannel]);

  const speedUnit = useUnitsStore((s) => s.speedUnit);
  const temperatureUnit = useUnitsStore((s) => s.temperatureUnit);
  const distanceUnit = useUnitsStore((s) => s.distanceUnit);
  const angularUnit = useUnitsStore((s) => s.angularUnit);

  const valueLabel =
    trackColorChannel === "speed" ? "Speed" : trackColorChannel;
  const nativeUnits =
    trackColorChannel === "speed"
      ? "m/s"
      : session?.channels.find((c) => c.name === trackColorChannel)?.units || "";
  // Pick a unit-conversion strategy based on channel's native units
  let valueUnits = nativeUnits;
  let mapConvert: ((v: number) => number) | null = null;
  if (isSpeedUnits(nativeUnits)) {
    valueUnits = SPEED_UNIT_LABEL[speedUnit];
    mapConvert = (v) => convertSpeed(v, nativeUnits, speedUnit);
  } else if (isTemperatureUnits(nativeUnits)) {
    valueUnits = TEMP_UNIT_LABEL[temperatureUnit];
    mapConvert = (v) => convertTemperature(v, nativeUnits, temperatureUnit);
  } else if (isDistanceUnits(nativeUnits)) {
    valueUnits = DISTANCE_UNIT_LABEL[distanceUnit];
    mapConvert = (v) => convertDistance(v, nativeUnits, distanceUnit);
  } else if (isAngularUnits(nativeUnits)) {
    valueUnits = ANGULAR_UNIT_LABEL[angularUnit];
    mapConvert = (v) => convertAngular(v, nativeUnits, angularUnit);
  }

  const convertedMapTraces: LapTrace[] = useMemo(() => {
    if (!mapConvert) return finalMapTraces;
    const fn = mapConvert;
    return finalMapTraces.map((tr) => ({
      ...tr,
      values: tr.values ? tr.values.map(fn) : undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalMapTraces, nativeUnits, speedUnit, temperatureUnit, distanceUnit, angularUnit]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border text-xs shrink-0">
        {/* Time/Distance toggle */}
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setXAxisMode("time")}
            className={`px-2 py-0.5 rounded transition-colors ${
              xAxisMode === "time"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Time
          </button>
          <button
            onClick={() => setXAxisMode("distance")}
            className={`px-2 py-0.5 rounded transition-colors ${
              xAxisMode === "distance"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Distance
          </button>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Reset zoom */}
        {zoomRange && (
          <button
            onClick={() => setZoomRange(null)}
            className="px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset Zoom
          </button>
        )}

        {/* Track color channel selector */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-muted-foreground">Track:</span>
          <select
            value={trackColorChannel}
            onChange={(e) => setTrackColorChannel(e.target.value)}
            className="bg-muted border-none rounded px-1.5 py-0.5 text-xs text-foreground"
          >
            <option value="speed">Speed</option>
            {session.channels
              .filter((c) => c.category !== "Position" && c.sample_count > 10)
              .slice(0, 20)
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Unit settings */}
        <UnitSettings />
        <KeyboardHelp />
        <a
          href="/settings"
          className="px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
          title="Open settings"
        >
          ⚙ Settings
        </a>

        <div className="w-px h-4 bg-border" />

        {/* Math channel editor toggle */}
        <button
          onClick={() => setShowMathEditor(!showMathEditor)}
          className={`px-2 py-0.5 rounded transition-colors ${
            showMathEditor
              ? "bg-purple-500/20 text-purple-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          f(x) Math
        </button>

        <div className="w-px h-4 bg-border" />

        {/* Export CSV */}
        <button
          onClick={handleExportCsv}
          disabled={!refLap}
          className="px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        >
          Export CSV
        </button>

        <button
          onClick={() => window.open(getExportPdfUrl(sessionId, refLap?.num), "_blank")}
          disabled={!refLap}
          className="px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        >
          Export PDF
        </button>

        {/* Layout manager */}
        <LayoutManager
          currentConfig={{ charts }}
          onLoad={handleLoadLayout}
        />

        <div className="w-px h-4 bg-border" />

        {/* Add chart dropdown */}
        <div className="relative">
          <button
            onClick={() => setAddChartOpen(!addChartOpen)}
            className="px-2 py-0.5 bg-primary/10 text-primary hover:bg-primary/20 rounded transition-colors"
          >
            + Add Chart
          </button>
          {addChartOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAddChartOpen(false)}
              />
              <div className="absolute top-full right-0 mt-1 z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => handleAddChart(type)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                  >
                    {CHART_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main layout */}
      <Group orientation="horizontal" className="flex-1">
        {/* Left sidebar */}
        <Panel
          id="sidebar"
          defaultSize="22%"
          minSize="16%"
          maxSize="35%"
          className="bg-card border-r border-border overflow-hidden"
        >
          <Group orientation="vertical" className="h-full">
            {/* Lap selector */}
            <Panel id="laps" defaultSize="40%" minSize="15%">
              <div className="h-full overflow-y-auto p-1">
                <LapSelector />
              </div>
            </Panel>
            <Separator className="h-1.5 bg-border hover:bg-primary/50 transition-colors cursor-row-resize" />
            {/* Channel browser / Math editor */}
            <Panel id="channels" defaultSize="35%" minSize="15%">
              <div className="h-full overflow-hidden flex flex-col">
                {showMathEditor ? (
                  <div className="flex-1 overflow-y-auto p-2">
                    <MathChannelEditor
                      sessionId={sessionId}
                      onChannelCreated={() => loadSession(sessionId)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden flex flex-col p-1">
                    <ChannelBrowser
                      activeChannels={allActiveChannels}
                      onToggleChannel={handleToggleChannel}
                    />
                  </div>
                )}
              </div>
            </Panel>
            <Separator className="h-1.5 bg-border hover:bg-primary/50 transition-colors cursor-row-resize" />
            {/* Mini track map */}
            <Panel id="trackmap" defaultSize="25%" minSize="10%">
              <div className="h-full p-2">
                {convertedMapTraces.length > 0 ? (
                  <TrackMap
                    laps={convertedMapTraces}
                    valueLabel={valueLabel}
                    valueUnits={valueUnits}
                    interactive
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    No track data
                  </div>
                )}
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="w-1.5 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

        {/* Main chart area */}
        <Panel id="main" defaultSize="78%" minSize="50%">
          <div className="h-full overflow-y-auto p-3 space-y-2 bg-background">
            {charts.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Click &quot;+ Add Chart&quot; or select channels from the sidebar
              </div>
            ) : (
              charts.map((chart, idx) => (
                <div
                  key={chart.id}
                  className="relative group"
                  draggable
                  onDragStart={handleDragStart(idx)}
                  onDragOver={handleDragOver(idx)}
                  onDrop={handleDrop(idx)}
                >
                  {/* Chart header */}
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
                    <span
                      className="cursor-grab active:cursor-grabbing select-none opacity-40 group-hover:opacity-100"
                      title="Drag to reorder"
                    >
                      ⠿
                    </span>
                    <span className="font-medium text-foreground/70">
                      {CHART_TYPE_LABELS[chart.type]}
                    </span>
                    {chart.channels.map((ch) => (
                      <span
                        key={ch}
                        className="px-1.5 py-0.5 bg-white/5 rounded text-[10px]"
                      >
                        {ch}
                      </span>
                    ))}
                    <button
                      onClick={() => handleRemoveChart(chart.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground px-1"
                      title="Remove chart"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Chart body (drop target for channels) */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      const chName = e.dataTransfer.getData(
                        "application/x-channel"
                      );
                      if (chName) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDropChannel(chart.id, chName);
                      }
                    }}
                  >
                    <ChartRenderer
                      chart={chart}
                      sessionId={sessionId}
                      height={chartHeight}
                    />
                  </div>
                </div>
              ))
            )}

            {/* Session notes */}
            <div className="mt-4">
              <SessionNotes sessionId={sessionId} />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}

// ---- Chart renderer (dispatches by type) ----

function ChartRenderer({
  chart,
  sessionId,
  height,
}: {
  chart: ChartConfig;
  sessionId: string;
  height: number;
}) {
  const session = useSessionStore((s) => s.session);

  switch (chart.type) {
    case "telemetry":
      return (
        <TelemetryChart
          channels={chart.channels}
          sessionId={sessionId}
          height={height}
        />
      );

    case "delta":
      return <DeltaChart sessionId={sessionId} height={height} />;

    case "stats":
      return (
        <StatsPanel
          sessionId={sessionId}
          channels={
            chart.channels.length > 0
              ? chart.channels
              : session?.channels
                  .filter(
                    (c) =>
                      c.category !== "Position" &&
                      c.category !== "Timing" &&
                      c.sample_count > 10
                  )
                  .slice(0, 8)
                  .map((c) => c.name) ?? []
          }
          height={height}
        />
      );

    case "histogram":
      return (
        <HistogramWrapper
          channels={chart.channels}
          sessionId={sessionId}
          height={height}
        />
      );

    case "scatter":
      return (
        <ScatterWrapper
          channels={chart.channels}
          sessionId={sessionId}
          height={height}
        />
      );

    case "laptime":
      return <LaptimeWrapper sessionId={sessionId} height={height} />;

    case "sector":
      return <SectorWrapper sessionId={sessionId} height={height} />;

    case "fft":
      return (
        <FFTWrapper
          channels={chart.channels}
          sessionId={sessionId}
          height={height}
        />
      );

    case "predictive":
      return <PredictiveChart sessionId={sessionId} height={height} />;

    case "suspension":
      return <SuspensionChart sessionId={sessionId} height={height} />;

    default:
      return (
        <div
          className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
          style={{ height }}
        >
          Unknown chart type: {chart.type}
        </div>
      );
  }
}

// ---- Wrapper components that wire up existing chart components ----

function HistogramWrapper({
  channels,
  sessionId,
  height,
}: {
  channels: string[];
  sessionId: string;
  height: number;
}) {
  const { refLap } = useLapStore();
  const [values, setValues] = useState<number[]>([]);
  const [channelName, setChannelName] = useState(channels[0] || "");

  useEffect(() => {
    if (!refLap || !channelName) return;
    import("@/lib/api").then(({ fetchResampledData }) =>
      fetchResampledData(sessionId, [channelName], refLap.num)
        .then((d) => setValues(Array.from(d.channels[channelName] ?? [])))
        .catch(() => setValues([]))
    );
  }, [sessionId, channelName, refLap]);

  return (
    <div style={{ height }}>
      {values.length > 0 ? (
        <HistogramChart
          data={values}
          channelName={channelName}
          units=""
        />
      ) : (
        <div
          className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
          style={{ height }}
        >
          {refLap
            ? `No data for ${channelName || "channel"}`
            : "Select a lap to view histogram"}
        </div>
      )}
    </div>
  );
}

function ScatterWrapper({
  channels,
  sessionId,
  height,
}: {
  channels: string[];
  sessionId: string;
  height: number;
}) {
  const { refLap } = useLapStore();
  const xCh = channels[0] || "GPS Speed";
  const yCh = channels[1] || "GPS_LateralAcc";

  return (
    <div style={{ height }}>
      <ScatterChart
        xChannel={xCh}
        yChannel={yCh}
        sessionId={sessionId}
        lap={refLap?.num}
      />
    </div>
  );
}

function LaptimeWrapper({
  sessionId,
  height,
}: {
  sessionId: string;
  height: number;
}) {
  const session = useSessionStore((s) => s.session);
  const { refLap } = useLapStore();

  if (!session) return null;

  const laps = session.laps.filter((l) => l.num > 0 && l.duration_ms > 0);

  return (
    <div style={{ height }}>
      <LapTimeChart
        laps={laps}
        refLapNum={refLap?.num ?? null}
      />
    </div>
  );
}

function SectorWrapper({
  sessionId,
  height,
}: {
  sessionId: string;
  height: number;
}) {
  return <SectorAnalysis sessionId={sessionId} height={height} />;
}

function FFTWrapper({
  channels,
  sessionId,
  height,
}: {
  channels: string[];
  sessionId: string;
  height: number;
}) {
  return (
    <FFTChart
      sessionId={sessionId}
      channels={channels.length > 0 ? channels : ["RPM"]}
      height={height}
    />
  );
}
