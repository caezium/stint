"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchLogSheet, saveLogSheet, type LogSheet } from "@/lib/api";

interface Props {
  sessionId: string;
}

const EMPTY: LogSheet = {
  weather: "",
  track_temp: 0,
  air_temp: 0,
  tire_pressures_json: "",
  setup_notes: "",
  fuel_level: 0,
  driver_rating: 0,
};

export function LogSheetPanel({ sessionId }: Props) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<LogSheet>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchLogSheet(sessionId)
      .then((s) => setSheet({ ...EMPTY, ...s }))
      .catch(() => setSheet(EMPTY));
  }, [open, sessionId]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveLogSheet(sessionId, sheet);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="font-semibold text-sm hover:text-foreground w-full text-left"
        >
          {open ? "▾" : "▸"} Log Sheet
        </button>
        {open && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <LabeledInput label="Weather" value={sheet.weather}
              onChange={(v) => setSheet({ ...sheet, weather: v })} />
            <LabeledInput label="Track temp (°C)" type="number" value={String(sheet.track_temp)}
              onChange={(v) => setSheet({ ...sheet, track_temp: Number(v) || 0 })} />
            <LabeledInput label="Air temp (°C)" type="number" value={String(sheet.air_temp)}
              onChange={(v) => setSheet({ ...sheet, air_temp: Number(v) || 0 })} />
            <LabeledInput label="Fuel level (L)" type="number" value={String(sheet.fuel_level)}
              onChange={(v) => setSheet({ ...sheet, fuel_level: Number(v) || 0 })} />
            <LabeledInput label="Driver rating (1-10)" type="number" value={String(sheet.driver_rating)}
              onChange={(v) => setSheet({ ...sheet, driver_rating: Number(v) || 0 })} />
            <LabeledInput label="Tire pressures (JSON)" value={sheet.tire_pressures_json}
              onChange={(v) => setSheet({ ...sheet, tire_pressures_json: v })} />
            <div className="md:col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Setup notes</label>
              <textarea
                value={sheet.setup_notes}
                onChange={(e) => setSheet({ ...sheet, setup_notes: e.target.value })}
                rows={3}
                className="w-full bg-muted rounded p-2 text-sm"
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={busy}>Save log sheet</Button>
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LabeledInput({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
