"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { fetchSetting, saveSetting } from "@/lib/api";

export default function SettingsPage() {
  const [template, setTemplate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSetting("session_naming_template")
      .then((v) => setTemplate(v || "{driver} — {track} — {date}"))
      .catch(() => setTemplate("{driver} — {track} — {date}"));
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
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h2 className="font-semibold text-sm">Session naming template</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Tokens: <code>{"{driver}"}</code>, <code>{"{vehicle}"}</code>, <code>{"{track}"}</code>,{" "}
              <code>{"{date}"}</code>, <code>{"{time}"}</code>. If any token is unresolved, the default
              file-based name is used.
            </p>
          </div>
          <Input value={template} onChange={(e) => setTemplate(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy}>Save</Button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
