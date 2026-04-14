"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSessions, fetchSession, type Session, type Lap } from "@/lib/api";
import { useLapStore } from "@/stores/lap-store";
import { formatLapTime } from "@/lib/constants";

interface ComparisonPickerProps {
  /** Current session ID — excluded from the picker list */
  currentSessionId: string;
}

function sessionLabel(s: Session): string {
  const date = s.log_date || "";
  const time = s.log_time || "";
  const who = s.driver || "Driver";
  const venue = s.venue || "";
  return `${date} ${time} ${venue} — ${who}`.trim();
}

export function ComparisonPicker({ currentSessionId }: ComparisonPickerProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [laps, setLaps] = useState<Lap[] | null>(null);
  const [loading, setLoading] = useState(false);

  const addCrossSessionLap = useLapStore((s) => s.addCrossSessionLap);

  useEffect(() => {
    if (!open || sessions != null) return;
    fetchSessions()
      .then((all) => setSessions(all.filter((s) => s.id !== currentSessionId)))
      .catch(() => setSessions([]));
  }, [open, sessions, currentSessionId]);

  useEffect(() => {
    if (!selectedId) { setLaps(null); return; }
    setLoading(true);
    fetchSession(selectedId)
      .then((d) => setLaps(d.laps.filter((l) => l.num > 0 && l.duration_ms > 0)))
      .catch(() => setLaps([]))
      .finally(() => setLoading(false));
  }, [selectedId]);

  function pickLap(lap: Lap) {
    if (!selectedId || !sessions) return;
    const sess = sessions.find((s) => s.id === selectedId);
    if (!sess) return;
    addCrossSessionLap({
      sessionId: selectedId,
      sessionLabel: sessionLabel(sess),
      lap,
    });
  }

  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 260) });
  }, [open]);

  return (
    <div>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1 text-[11px] bg-muted hover:bg-muted/70 rounded text-muted-foreground hover:text-foreground transition-colors"
        title="Add a lap from another session for comparison"
      >
        + Compare other session
      </button>

      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-card border border-border rounded-md shadow-lg max-h-[400px] overflow-hidden flex flex-col"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            {/* Session list */}
            {!selectedId ? (
              <div className="overflow-y-auto p-1 text-xs">
                {sessions == null && (
                  <div className="p-2 text-muted-foreground">Loading…</div>
                )}
                {sessions?.length === 0 && (
                  <div className="p-2 text-muted-foreground">
                    No other sessions available
                  </div>
                )}
                {sessions?.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="w-full text-left px-2 py-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <div className="truncate">{sessionLabel(s)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.lap_count} laps · best{" "}
                      {s.best_lap_time_ms != null
                        ? formatLapTime(s.best_lap_time_ms)
                        : "--"}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 p-1 border-b border-border text-xs">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                  <span className="text-muted-foreground truncate">
                    {sessions?.find((s) => s.id === selectedId)?.driver}
                  </span>
                </div>
                <div className="overflow-y-auto p-1 text-xs">
                  {loading && (
                    <div className="p-2 text-muted-foreground">Loading laps…</div>
                  )}
                  {laps?.map((lap) => (
                    <button
                      key={lap.num}
                      onClick={() => pickLap(lap)}
                      className="w-full flex items-center justify-between px-2 py-1 hover:bg-muted rounded transition-colors"
                    >
                      <span className="font-mono">L{lap.num}</span>
                      <span className="font-mono text-muted-foreground">
                        {formatLapTime(lap.duration_ms)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
