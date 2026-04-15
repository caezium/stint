"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadFile, fetchTrack, matchTrack, assignSession, type UploadResult } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setError(null);
      setResult(null);

      if (file.size > MAX_UPLOAD_SIZE) {
        setError(
          `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 100 MB.`
        );
        return;
      }

      setUploading(true);

      try {
        const res = await uploadFile(file);
        setResult(res);
        // Auto-match against stored tracks (best-effort, non-blocking)
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
          /* ignore match failures */
        }
        // Auto-redirect after a short delay
        setTimeout(() => {
          router.push(`/sessions/${res.session_id}`);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
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
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-2xl font-bold tracking-tight mb-2">Upload Session</h1>
      <p className="text-muted-foreground text-sm mb-8">
        Upload an XRK or XRZ file from your AiM data logger.
      </p>

      <Card>
        <CardContent className="p-8">
          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
              transition-colors duration-200
              ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }
              ${uploading ? "pointer-events-none opacity-60" : ""}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xrk,.xrz"
              onChange={onFileSelect}
              className="hidden"
            />

            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <svg
                  className="animate-spin h-8 w-8 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <p className="text-sm text-muted-foreground">
                  Uploading {selectedFile?.name}...
                </p>
              </div>
            ) : (
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
                    Drop your file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports .xrk and .xrz files (max 100 MB)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Success */}
          {result && (
            <div className="mt-4 p-4 rounded-md bg-green-500/10 border border-green-500/20">
              <p className="text-sm font-medium text-green-400 mb-2">
                Upload successful!
              </p>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Driver: {result.driver || "—"}</p>
                <p>Venue: {result.venue || "—"}</p>
                <p>Laps: {result.lap_count}</p>
                <p>Channels: {result.channel_count}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Redirecting to session...
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
