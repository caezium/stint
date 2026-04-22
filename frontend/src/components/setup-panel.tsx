"use client";

import { useEffect, useState } from "react";
import {
  fetchSessionSetup,
  saveSessionSetup,
  type SetupData,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TIRE_CORNERS = ["fl", "fr", "rl", "rr"] as const;
const TIRE_LABELS: Record<(typeof TIRE_CORNERS)[number], string> = {
  fl: "Front L",
  fr: "Front R",
  rl: "Rear L",
  rr: "Rear R",
};

const EMPTY: SetupData = {
  gear_ratios: [],
  tire_compound: "",
  tire_pressures: {},
  chassis_notes: "",
  front_wing: "",
  rear_wing: "",
};

/**
 * Structured vehicle setup sheet (Phase 26.4). Gears / tires / chassis
 * notes that persist per-session and, on a fresh session for the same
 * vehicle, pre-fill from the vehicle's template if set.
 */
export function SetupPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<SetupData>(EMPTY);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionSetup(sessionId)
      .then(setData)
      .catch(() => setData(EMPTY));
  }, [sessionId]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveSessionSetup(sessionId, data);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const hasContent =
    data.gear_ratios.length > 0 ||
    data.tire_compound.length > 0 ||
    Object.keys(data.tire_pressures).length > 0 ||
    data.chassis_notes.length > 0 ||
    data.front_wing.length > 0 ||
    data.rear_wing.length > 0;

  return (
    <Card>
      <CardContent className="p-0">
        <div
          className="px-5 py-3 border-b border-border cursor-pointer flex items-center justify-between"
          onClick={() => setExpanded((v) => !v)}
        >
          <div>
            <h2 className="font-semibold text-sm">
              Vehicle setup{" "}
              {hasContent && (
                <span className="text-[10px] text-emerald-400 font-normal ml-1">
                  · configured
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {expanded
                ? "Click header to collapse."
                : "Gears, tires, chassis notes. Click to edit."}
            </p>
          </div>
          <span className="text-muted-foreground text-sm">{expanded ? "▾" : "▸"}</span>
        </div>

        {expanded && (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Gear ratios (comma-separated, outer → inner)
              </label>
              <Input
                placeholder="e.g. 12, 15, 18, 22"
                value={data.gear_ratios.join(", ")}
                onChange={(e) =>
                  setData({
                    ...data,
                    gear_ratios: e.target.value
                      .split(/[,\s]+/)
                      .map((x) => Number(x))
                      .filter((x) => !Number.isNaN(x)),
                  })
                }
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Tire compound
              </label>
              <Input
                placeholder="Vega SLA, Bridgestone YLB, …"
                value={data.tire_compound}
                onChange={(e) =>
                  setData({ ...data, tire_compound: e.target.value })
                }
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Tire pressures (psi)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                {TIRE_CORNERS.map((c) => (
                  <div key={c}>
                    <div className="text-[10px] text-muted-foreground">
                      {TIRE_LABELS[c]}
                    </div>
                    <Input
                      type="number"
                      step="0.1"
                      value={data.tire_pressures[c] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        const copy = { ...data.tire_pressures };
                        if (v === "") delete copy[c];
                        else copy[c] = Number(v);
                        setData({ ...data, tire_pressures: copy });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Front wing
                </label>
                <Input
                  value={data.front_wing}
                  onChange={(e) => setData({ ...data, front_wing: e.target.value })}
                  placeholder="n/a for karts"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Rear wing
                </label>
                <Input
                  value={data.rear_wing}
                  onChange={(e) => setData({ ...data, rear_wing: e.target.value })}
                  placeholder="n/a for karts"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Chassis notes
              </label>
              <textarea
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm h-20 focus:outline-none focus:ring-2 focus:ring-ring"
                value={data.chassis_notes}
                onChange={(e) =>
                  setData({ ...data, chassis_notes: e.target.value })
                }
                placeholder="Stiff front axle, heavy caster, etc."
              />
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save setup"}
              </Button>
              {msg && (
                <span className="text-xs text-muted-foreground">{msg}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
