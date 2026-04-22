"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadFile, fetchTrack, matchTrack, assignSession, DuplicateUploadError, type UploadResult } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

type QueueItem = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "matching" | "ok" | "duplicate" | "error";
  error?: string;
  result?: UploadResult;
  /** When status === 'duplicate', the session_id of the existing upload. */
  duplicateOfSessionId?: string;
};

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);

  const processOne = useCallback(async (item: QueueItem) => {
    const update = (patch: Partial<QueueItem>) =>
      setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));

    if (item.file.size > MAX_UPLOAD_SIZE) {
      update({
        status: "error",
        error: `File too large (${(item.file.size / 1024 / 1024).toFixed(1)} MB, max 100)`,
      });
      return;
    }

    update({ status: "uploading" });
    try {
      const res = await uploadFile(item.file);
      update({ status: "matching", result: res });

      // Best-effort auto-match; silent failure
      try {
        const track = await fetchTrack(res.session_id);
        if (track.lat.length > 0) {
          const outline: number[][] = track.lat.map((la, i) => [la, track.lon[i]]);
          const m = await matchTrack(outline);
          if (m.matched && m.match) {
            await assignSession(res.session_id, { track_id: m.match.id });
          }
        }
      } catch {
        /* ignore */
      }

      update({ status: "ok" });
    } catch (err) {
      if (err instanceof DuplicateUploadError) {
        update({
          status: "duplicate",
          duplicateOfSessionId: err.sessionId,
          error: "Already uploaded",
        });
        return;
      }
      update({
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }, []);

  const processQueue = useCallback(
    async (items: QueueItem[]) => {
      setProcessing(true);
      // Serial processing — a batch of 11 XRKs in parallel would hammer the
      // backend. Also gives a cleaner progress UX.
      for (const item of items) {
        await processOne(item);
      }
      setProcessing(false);
    },
    [processOne]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const items: QueueItem[] = files.map((f) => ({
        id: genId(),
        file: f,
        status: "pending",
      }));
      setQueue((q) => [...q, ...items]);
      void processQueue(items);
    },
    [processQueue]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(xrk|xrz)$/i.test(f.name)
      );
      addFiles(files);
    },
    [addFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      addFiles(files);
      // Reset so the same file can be re-selected later
      e.target.value = "";
    },
    [addFiles]
  );

  const retry = useCallback(
    (id: string) => {
      const item = queue.find((q) => q.id === id);
      if (!item) return;
      void processQueue([{ ...item, status: "pending", error: undefined }]);
    },
    [queue, processQueue]
  );

  const removeItem = useCallback((id: string) => {
    setQueue((q) => q.filter((i) => i.id !== id));
  }, []);

  const completed = queue.filter((q) => q.status === "ok").length;
  const total = queue.length;
  const allDone = total > 0 && !processing && queue.every((q) => q.status === "ok" || q.status === "error");
  const anyOk = queue.some((q) => q.status === "ok");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-2xl font-bold tracking-tight mb-2">Upload Sessions</h1>
      <p className="text-muted-foreground text-sm mb-8">
        Drop one or many XRK / XRZ files from your AiM data logger.
      </p>

      <Card>
        <CardContent className="p-8">
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-10 text-center cursor-pointer
              transition-colors duration-200
              ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }
              ${processing ? "pointer-events-none opacity-60" : ""}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xrk,.xrz"
              multiple
              onChange={onFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium">
                  Drop files here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports .xrk and .xrz · max 100 MB each
                </p>
              </div>
            </div>
          </div>

          {queue.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
                <span>
                  {completed} of {total} uploaded
                </span>
                {processing && <span>Uploading…</span>}
              </div>
              <div className="border border-border/60 rounded-md divide-y divide-border/40">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <StatusDot status={item.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.file.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {statusLabel(item)}
                      </div>
                    </div>
                    {item.status === "ok" && item.result && (
                      <Link
                        href={`/sessions/${item.result.session_id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open →
                      </Link>
                    )}
                    {item.status === "duplicate" && item.duplicateOfSessionId && (
                      <Link
                        href={`/sessions/${item.duplicateOfSessionId}`}
                        className="text-xs text-amber-400 hover:underline"
                      >
                        Open existing →
                      </Link>
                    )}
                    {item.status === "error" && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                        onClick={() => retry(item.id)}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      className="text-muted-foreground hover:text-red-400 text-xs"
                      onClick={() => removeItem(item.id)}
                      disabled={item.status === "uploading" || item.status === "matching"}
                      title="Remove from queue"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {allDone && anyOk && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {completed === 1
                      ? "Upload complete."
                      : `All ${completed} uploads finished.`}
                  </p>
                  <div className="flex gap-2">
                    {completed === 1 && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const ok = queue.find((q) => q.status === "ok" && q.result);
                          if (ok?.result) router.push(`/sessions/${ok.result.session_id}`);
                        }}
                      >
                        Open session
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={completed === 1 ? "secondary" : "default"}
                      onClick={() => router.push("/sessions")}
                    >
                      Go to sessions
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusDot({ status }: { status: QueueItem["status"] }) {
  const color =
    status === "ok"
      ? "bg-green-500"
      : status === "error"
        ? "bg-red-500"
        : status === "duplicate"
          ? "bg-amber-400"
          : status === "uploading" || status === "matching"
            ? "bg-amber-500 animate-pulse"
            : "bg-muted-foreground/50";
  return <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />;
}

function statusLabel(i: QueueItem): string {
  switch (i.status) {
    case "pending":
      return "Queued";
    case "uploading":
      return `Uploading (${(i.file.size / 1024 / 1024).toFixed(1)} MB)`;
    case "matching":
      return "Matching track…";
    case "ok":
      return `Done · ${i.result?.lap_count ?? "?"} laps · ${i.result?.venue ?? "—"}`;
    case "duplicate":
      return "Already uploaded";
    case "error":
      return `Error: ${i.error ?? "unknown"}`;
  }
}
