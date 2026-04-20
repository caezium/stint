"use client";

import { useEffect, useState } from "react";
import {
  fetchProposals,
  applyProposal,
  rejectProposal,
  type Proposal,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  sessionId: string;
}

export function ProposalsPanel({ sessionId }: Props) {
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  function refresh() {
    setLoading(true);
    fetchProposals(sessionId)
      .then((xs) => {
        setItems(xs);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }
  useEffect(refresh, [sessionId]);

  async function doApply(id: number) {
    setBusy(id);
    try {
      await applyProposal(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(null);
    }
  }
  async function doReject(id: number) {
    setBusy(id);
    try {
      await rejectProposal(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;
  if (!items.length) return null;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-base">Pending proposals</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Suggestions from the AI coach. Apply to persist, reject to dismiss.
          </p>
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="space-y-2">
          {items.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-border/60 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {p.kind === "layout" ? "Layout" : "Math channel"}
                    <span className="ml-2 text-xs text-muted-foreground">
                      via {p.source}
                    </span>
                  </div>
                  <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-words font-mono leading-snug">
                    {JSON.stringify(p.payload, null, 2).slice(0, 500)}
                  </pre>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => doApply(p.id)}
                    disabled={busy === p.id}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => doReject(p.id)}
                    disabled={busy === p.id}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
