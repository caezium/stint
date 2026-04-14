"use client";

import { useLapStore } from "@/stores/lap-store";
import { useSessionStore } from "@/stores/session-store";
import { formatLapTime } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ComparisonPicker } from "@/components/comparison-picker";

export function LapSelector() {
  const session = useSessionStore((s) => s.session);
  const {
    refLap,
    altLap,
    extraLaps,
    crossSessionLaps,
    setRefLap,
    setAltLap,
    toggleExtraLap,
    removeCrossSessionLap,
  } = useLapStore();

  if (!session) return null;

  const laps = session.laps;
  const validLaps = laps.filter((l) => l.num > 0 && l.duration_ms > 0);
  const bestTime =
    validLaps.length > 0
      ? Math.min(...validLaps.map((l) => l.duration_ms))
      : null;

  function handleClick(
    e: React.MouseEvent,
    lap: (typeof laps)[number]
  ) {
    if (e.shiftKey) {
      toggleExtraLap(lap);
      return;
    }

    if (!refLap || refLap.num === lap.num) {
      setRefLap(lap);
      setAltLap(null);
    } else if (!altLap) {
      setAltLap(lap);
    } else {
      // Cycle: clicking again sets new ref
      setRefLap(lap);
      setAltLap(null);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pb-1">
        Laps
      </h3>
      {laps.map((lap) => {
        const isOutLap = lap.num === 0;
        const isBest = bestTime !== null && lap.duration_ms === bestTime && lap.num > 0;
        const isRef = refLap?.num === lap.num;
        const isAlt = altLap?.num === lap.num;
        const isExtra = extraLaps.some((l) => l.num === lap.num);

        let borderColor = "border-transparent";
        if (isRef) borderColor = "border-red-500";
        else if (isAlt) borderColor = "border-blue-500";
        else if (isExtra) borderColor = "border-green-500";

        let bgColor = "hover:bg-muted/50";
        if (isRef) bgColor = "bg-red-500/10 hover:bg-red-500/20";
        else if (isAlt) bgColor = "bg-blue-500/10 hover:bg-blue-500/20";
        else if (isExtra) bgColor = "bg-green-500/10 hover:bg-green-500/20";

        return (
          <button
            key={lap.num}
            onClick={(e) => handleClick(e, lap)}
            disabled={isOutLap}
            className={cn(
              "flex items-center justify-between px-2 py-1.5 rounded text-sm border-l-2 transition-colors text-left",
              borderColor,
              bgColor,
              isOutLap && "opacity-40 cursor-default"
            )}
          >
            <span className="font-mono text-xs w-8">
              {isOutLap ? "Out" : `L${lap.num}`}
            </span>
            <span
              className={cn(
                "font-mono text-xs",
                isBest && "text-green-400 font-semibold"
              )}
            >
              {lap.duration_ms > 0 ? formatLapTime(lap.duration_ms) : "--:--.---"}
            </span>
            {isBest && (
              <span className="text-[10px] text-green-400 font-medium ml-1">
                BEST
              </span>
            )}
          </button>
        );
      })}
      <div className="text-[10px] text-muted-foreground px-2 pt-2">
        Click = ref lap, click another = alt lap
        <br />
        Shift+click = toggle extra lap
      </div>

      {/* Cross-session comparison */}
      <div className="mt-2 border-t border-border pt-2 px-1 space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          Compare Sessions
        </h3>
        <ComparisonPicker currentSessionId={session.id} />
        {crossSessionLaps.map((entry) => (
          <div
            key={`${entry.sessionId}-${entry.lap.num}`}
            className="flex items-center justify-between gap-1 px-2 py-1 bg-purple-500/10 border-l-2 border-purple-500 rounded text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="truncate text-foreground/80">
                L{entry.lap.num} · {formatLapTime(entry.lap.duration_ms)}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {entry.sessionLabel}
              </div>
            </div>
            <button
              onClick={() =>
                removeCrossSessionLap(entry.sessionId, entry.lap.num)
              }
              className="text-muted-foreground hover:text-foreground px-1"
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
