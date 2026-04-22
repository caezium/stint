"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchTrash,
  restoreSession,
  hardDeleteSession,
  type TrashedSession,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function TrashPage() {
  const [rows, setRows] = useState<TrashedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    fetchTrash()
      .then(setRows)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function doRestore(id: string) {
    setBusy(id);
    try {
      await restoreSession(id);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function doHardDelete(id: string) {
    if (!confirm("Permanently delete this session? This cannot be undone.")) return;
    setBusy(id);
    try {
      await hardDeleteSession(id);
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trash</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Soft-deleted sessions. Items older than 7 days are purged
            automatically by the background worker.
          </p>
        </div>
        <Link href="/sessions">
          <Button variant="secondary" size="sm">Back to sessions</Button>
        </Link>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-8 text-xs text-muted-foreground text-center">
            Loading trash…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground text-center">
            Trash is empty.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1fr_140px_160px_140px] gap-3 px-4 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
              <div>Venue / Driver</div>
              <div>Laps</div>
              <div>Deleted</div>
              <div className="text-right">Actions</div>
            </div>
            {rows.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_140px_160px_140px] gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0 text-sm items-center"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {s.venue || "Unknown Venue"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.driver || "—"}
                    {s.vehicle && ` · ${s.vehicle}`}
                    {s.log_date && ` · ${s.log_date}`}
                  </div>
                </div>
                <div>{s.lap_count}</div>
                <div className="text-xs text-muted-foreground">{s.deleted_at}</div>
                <div className="flex gap-1 justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === s.id}
                    onClick={() => doRestore(s.id)}
                  >
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === s.id}
                    onClick={() => doHardDelete(s.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
