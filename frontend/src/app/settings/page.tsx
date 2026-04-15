"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchSetting,
  saveSetting,
  clearAllSessions,
} from "@/lib/api";
import {
  useUnitsStore,
  SPEED_UNIT_LABEL,
  TEMP_UNIT_LABEL,
  DISTANCE_UNIT_LABEL,
  ANGULAR_UNIT_LABEL,
  COLORMAP_LABEL,
  COLORMAP_RAMPS,
  rampToCssGradient,
  type SpeedUnit,
  type TemperatureUnit,
  type DistanceUnit,
  type AngularUnit,
  type Colormap,
} from "@/stores/units-store";

const DEFAULT_TEMPLATE = "{driver} — {track} — {date}";

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Section
        title="General"
        description="Session naming and other app-wide preferences."
      >
        <GeneralSection />
      </Section>

      <Section
        title="Integrations"
        description="External services used to enrich session data."
      >
        <IntegrationsSection />
      </Section>

      <Section
        title="Units & Display"
        description="Default units and colormap. These also control the in-context units popover in the analysis toolbar."
      >
        <UnitsSection />
      </Section>

      <Section
        title="Data"
        description="Destructive operations. These cannot be undone."
      >
        <DataSection />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="font-heading text-lg font-medium">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">{children}</CardContent>
      </Card>
    </section>
  );
}

// ---------- General ----------

function GeneralSection() {
  const [template, setTemplate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSetting("session_naming_template")
      .then((v) => setTemplate(v || DEFAULT_TEMPLATE))
      .catch(() => setTemplate(DEFAULT_TEMPLATE));
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveSetting("session_naming_template", template);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">Session naming template</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Tokens: <code>{"{driver}"}</code>, <code>{"{vehicle}"}</code>,{" "}
          <code>{"{track}"}</code>, <code>{"{date}"}</code>,{" "}
          <code>{"{time}"}</code>. If any token is unresolved, the default
          file-based name is used.
        </p>
      </div>
      <Input value={template} onChange={(e) => setTemplate(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
        {msg && (
          <span className="text-xs text-muted-foreground">{msg}</span>
        )}
      </div>
    </div>
  );
}

// ---------- Integrations ----------

function IntegrationsSection() {
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSetting("openweather_api_key")
      .then((v) => setApiKey(v || ""))
      .catch(() => setApiKey(""));
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveSetting("openweather_api_key", apiKey);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">OpenWeather API key</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Used to backfill historical weather for sessions that have a log
          date. Requires a One Call 3.0 subscription.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type={show ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setShow((v) => !v)}
        >
          {show ? "Hide" : "Show"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
        {msg && (
          <span className="text-xs text-muted-foreground">{msg}</span>
        )}
      </div>
    </div>
  );
}

// ---------- Units & Display ----------

function UnitsSection() {
  const s = useUnitsStore();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Row label="Speed">
        <Select
          value={s.speedUnit}
          onChange={(v) => s.setSpeedUnit(v as SpeedUnit)}
          options={SPEED_UNIT_LABEL}
        />
      </Row>
      <Row label="Temperature">
        <Select
          value={s.temperatureUnit}
          onChange={(v) => s.setTemperatureUnit(v as TemperatureUnit)}
          options={TEMP_UNIT_LABEL}
        />
      </Row>
      <Row label="Distance">
        <Select
          value={s.distanceUnit}
          onChange={(v) => s.setDistanceUnit(v as DistanceUnit)}
          options={DISTANCE_UNIT_LABEL}
        />
      </Row>
      <Row label="Angular">
        <Select
          value={s.angularUnit}
          onChange={(v) => s.setAngularUnit(v as AngularUnit)}
          options={ANGULAR_UNIT_LABEL}
        />
      </Row>
      <div className="sm:col-span-2 space-y-1">
        <Row label="Colormap">
          <Select
            value={s.colormap}
            onChange={(v) => s.setColormap(v as Colormap)}
            options={COLORMAP_LABEL}
          />
        </Row>
        <div
          className="h-2 rounded-sm"
          style={{ background: rampToCssGradient(COLORMAP_RAMPS[s.colormap]) }}
        />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-muted border-none rounded px-2 py-1 text-xs text-foreground"
    >
      {Object.keys(options).map((k) => (
        <option key={k} value={k}>
          {options[k]}
        </option>
      ))}
    </select>
  );
}

// ---------- Data / Reset ----------

function DataSection() {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doClear() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await clearAllSessions();
      setMsg(`Cleared. Purged ${r.purged.length} dir(s).`);
      setConfirmClear(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function doResetSettings() {
    try {
      // Wipe persisted Zustand stores and any app localStorage keys.
      const keys = Object.keys(window.localStorage);
      for (const k of keys) {
        if (
          k === "stint-units" ||
          k === "stint-xaxis-mode" ||
          k.startsWith("stint-charts-")
        ) {
          window.localStorage.removeItem(k);
        }
      }
      // Also reset server-side naming template + api key to empty.
      saveSetting("session_naming_template", "").catch(() => null);
      setMsg("Settings reset. Reload to see defaults.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setConfirmReset(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Clear all sessions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Removes all sessions, laps, log sheets, and purges cached telemetry
            and uploaded XRK files.
          </p>
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmClear(true)}
          disabled={busy}
        >
          Clear
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Reset settings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resets units, colormap, chart layouts and naming template to
            defaults. Does not touch session data.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmReset(true)}
          disabled={busy}
        >
          Reset
        </Button>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all sessions?</DialogTitle>
            <DialogDescription>
              This permanently deletes every session, lap, log sheet, and the
              cached telemetry/XRK files on disk. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doClear}
              disabled={busy}
            >
              {busy ? "Clearing…" : "Clear everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset settings?</DialogTitle>
            <DialogDescription>
              Restores units, colormap, saved chart layouts and the session
              naming template to defaults. Session data is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={doResetSettings}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
