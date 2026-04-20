"use client";

import { useEffect, useState } from "react";
import {
  createShare,
  fetchShares,
  revokeShare,
  type ShareToken,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function ShareDialog({ sessionId, onClose }: Props) {
  const [shares, setShares] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    fetchShares(sessionId)
      .then(setShares)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }
  useEffect(refresh, [sessionId]);

  async function mint() {
    setBusy(true);
    try {
      await createShare(sessionId);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    setBusy(true);
    try {
      await revokeShare(token);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copyUrl(token: string) {
    const url = `${window.location.origin}/share/sessions/${token}`;
    try {
      navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-lg border border-border bg-background p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-base">Share with a coach</h2>
            <p className="text-xs text-muted-foreground">
              Read-only link — no login required to view.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <Button size="sm" onClick={mint} disabled={busy}>
          {busy ? "Generating…" : "Generate new link"}
        </Button>

        {loading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : shares.length === 0 ? (
          <div className="text-xs text-muted-foreground">No active shares.</div>
        ) : (
          <div className="space-y-1.5">
            {shares.map((s) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/share/sessions/${s.token}`;
              const revoked = !!s.revoked_at;
              return (
                <div
                  key={s.token}
                  className={`rounded-md border p-2 text-xs ${
                    revoked
                      ? "opacity-50 border-border/40"
                      : "border-border/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={url}
                      className="flex-1 bg-transparent font-mono truncate outline-none"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copyUrl(s.token)}
                      disabled={revoked}
                    >
                      {copied === s.token ? "Copied" : "Copy"}
                    </Button>
                    {!revoked && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => revoke(s.token)}
                        disabled={busy}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {s.view_count} view{s.view_count === 1 ? "" : "s"} ·{" "}
                    {revoked ? "Revoked" : `Created ${s.created_at}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
