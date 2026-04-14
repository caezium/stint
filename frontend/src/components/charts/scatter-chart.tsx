"use client";

import { useEffect, useRef, useState } from "react";
import { fetchChannelData } from "@/lib/api";

interface ScatterChartProps {
  xChannel: string;
  yChannel: string;
  sessionId: string;
  lap?: number;
}

export function ScatterChart({
  xChannel,
  yChannel,
  sessionId,
}: ScatterChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      setLoading(true);
      setError(null);

      try {
        const [xData, yData] = await Promise.all([
          fetchChannelData(sessionId, xChannel),
          fetchChannelData(sessionId, yChannel),
        ]);

        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        // Clear
        ctx.fillStyle = "#09090b";
        ctx.fillRect(0, 0, w, h);

        const xVals = xData.values;
        const yVals = yData.values;
        const len = Math.min(xVals.length, yVals.length);

        if (len === 0) {
          setError("No data points");
          setLoading(false);
          return;
        }

        // Compute bounds
        let xMin = Infinity, xMax = -Infinity;
        let yMin = Infinity, yMax = -Infinity;
        for (let i = 0; i < len; i++) {
          if (!isFinite(xVals[i]) || !isFinite(yVals[i])) continue;
          if (xVals[i] < xMin) xMin = xVals[i];
          if (xVals[i] > xMax) xMax = xVals[i];
          if (yVals[i] < yMin) yMin = yVals[i];
          if (yVals[i] > yMax) yMax = yVals[i];
        }

        const pad = { top: 20, right: 20, bottom: 40, left: 60 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;
        const xRange = xMax - xMin || 1;
        const yRange = yMax - yMin || 1;

        // Grid lines
        ctx.strokeStyle = "#27272a";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
          const y = pad.top + (i / 5) * plotH;
          ctx.beginPath();
          ctx.moveTo(pad.left, y);
          ctx.lineTo(w - pad.right, y);
          ctx.stroke();

          const x = pad.left + (i / 5) * plotW;
          ctx.beginPath();
          ctx.moveTo(x, pad.top);
          ctx.lineTo(x, h - pad.bottom);
          ctx.stroke();
        }

        // Axis labels
        ctx.fillStyle = "#71717a";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(xChannel, pad.left + plotW / 2, h - 6);

        ctx.save();
        ctx.translate(14, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yChannel, 0, 0);
        ctx.restore();

        // Tick labels
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        for (let i = 0; i <= 5; i++) {
          const val = xMin + (i / 5) * xRange;
          const x = pad.left + (i / 5) * plotW;
          ctx.fillText(val.toFixed(1), x, h - pad.bottom + 14);
        }
        ctx.textAlign = "right";
        for (let i = 0; i <= 5; i++) {
          const val = yMax - (i / 5) * yRange;
          const y = pad.top + (i / 5) * plotH;
          ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
        }

        // Plot dots
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < len; i++) {
          if (!isFinite(xVals[i]) || !isFinite(yVals[i])) continue;
          const px = pad.left + ((xVals[i] - xMin) / xRange) * plotW;
          const py = pad.top + ((yMax - yVals[i]) / yRange) * plotH;
          ctx.fillStyle = "#3b82f6";
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
          setLoading(false);
        }
      }
    }

    draw();
    return () => {
      cancelled = true;
    };
  }, [sessionId, xChannel, yChannel]);

  return (
    <div className="relative w-full" style={{ height: 400 }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
          <span className="text-sm text-muted-foreground">Loading scatter data...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg"
        style={{ background: "#09090b" }}
      />
    </div>
  );
}
