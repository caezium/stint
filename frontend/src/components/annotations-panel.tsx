"use client";

import { useEffect, useState } from "react";
import {
  fetchAnnotations,
  createAnnotation,
  deleteAnnotation,
  type LapAnnotation,
  type Lap,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface Props {
  sessionId: string;
  laps: Lap[];
}

export function AnnotationsPanel({ sessionId, laps }: Props) {
  const [items, setItems] = useState<LapAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draftLap, setDraftLap] = useState<number>(laps.find((l) => l.num > 0)?.num ?? 0);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnnotations(sessionId)
      .then((xs) => {
        if (!cancelled) {
          setItems(xs);
          setError(null);
        }
      })
      .catch((e: unknown) =>
        !cancelled && setError(e instanceof Error ? e.message : "Failed to load")
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function save() {
    const body = draftBody.trim();
    if (!body || !draftLap) return;
    setSaving(true);
    try {
      const created = await createAnnotation(sessionId, {
        lap_num: draftLap,
        body,
      });
      setItems((xs) => [...xs, created]);
      setDraftBody("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteAnnotation(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">Notes</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-lap driver notes — referenced by the AI coach.
            </p>
          </div>
          <Button size="sm" variant={adding ? "secondary" : "default"} onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add note"}
          </Button>
        </div>

        {adding && (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Lap</span>
              <Select<number>
                value={draftLap}
                onValueChange={setDraftLap}
                options={laps
                  .filter((l) => l.num > 0 && l.duration_ms > 0)
                  .map((l) => ({ value: l.num, label: `L${l.num}` }))}
              />
            </div>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="e.g. Lost the front into T3"
              className="w-full min-h-[60px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/60"
              maxLength={1000}
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !draftBody.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {loading && <div className="text-xs text-muted-foreground py-2">Loading…</div>}
        {error && <div className="text-xs text-destructive py-2">{error}</div>}
        {!loading && items.length === 0 && !adding && (
          <div className="text-xs text-muted-foreground py-3 text-center">
            No notes yet. Add one to anchor context for the chat agent.
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-1.5">
            {items.map((a) => (
              <div
                key={a.id}
                className="rounded-sm border-l-2 border-l-primary/60 bg-muted/30 px-3 py-2 text-sm flex items-start gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div>{a.body}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    L{a.lap_num}
                    {a.author ? ` · ${a.author}` : ""} · {a.created_at}
                  </div>
                </div>
                <button
                  className="text-muted-foreground hover:text-red-400 text-xs shrink-0"
                  onClick={() => remove(a.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
