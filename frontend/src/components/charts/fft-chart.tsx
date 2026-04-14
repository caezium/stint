"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useLapStore } from "@/stores/lap-store";

interface FFTData {
  frequencies_hz: number[];
  magnitudes: number[];
  sample_rate_hz: number;
  num_samples: number;
}

interface FFTChartProps {
  sessionId: string;
  channels: string[];
  height?: number;
}

export function FFTChart({ sessionId, channels, height = 250 }: FFTChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { refLap } = useLapStore();
  const [data, setData] = useState<FFTData | null>(null);
  const [channelName, setChannelName] = useState(channels[0] || "");
  const [error, setError] = useState<string | null>(null);

  // Update channel when props change
  useEffect(() => {
    if (channels[0] && channels[0] !== channelName) {
      setChannelName(channels[0]);
    }
  }, [channels]);

  // Fetch FFT data
  useEffect(() => {
    if (!refLap || !channelName) return;
    setError(null);
    fetch(
      `/api/sessions/${sessionId}/channels/${encodeURIComponent(channelName)}/fft?lap=${refLap.num}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`FFT failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      });
  }, [sessionId, channelName, refLap]);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.frequencies_hz.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 20, bottom: 35, left: 55 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Clear
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, w, h);

    const freqs = data.frequencies_hz;
    const mags = data.magnitudes;
    const maxFreq = freqs[freqs.length - 1];
    const maxMag = Math.max(...mags) * 1.1 || 1;

    // Grid lines
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = pad.top + (plotH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
    }

    // Draw spectrum
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = pad.left + (freqs[i] / maxFreq) * plotW;
      const y = pad.top + plotH - (mags[i] / maxMag) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = "rgba(168, 85, 247, 0.1)";
    ctx.fill();

    // Axes labels
    ctx.fillStyle = "#666";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";

    // X axis (frequency)
    for (let i = 0; i <= 5; i++) {
      const freq = (maxFreq * i) / 5;
      const x = pad.left + (i / 5) * plotW;
      ctx.fillText(`${freq.toFixed(0)}`, x, h - 5);
    }
    ctx.fillText("Frequency (Hz)", pad.left + plotW / 2, h - 18);

    // Y axis (magnitude)
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const mag = (maxMag * (5 - i)) / 5;
      const y = pad.top + (plotH * i) / 5;
      ctx.fillText(mag.toFixed(2), pad.left - 5, y + 3);
    }

    // Title
    ctx.fillStyle = "#888";
    ctx.textAlign = "left";
    ctx.font = "11px sans-serif";
    ctx.fillText(
      `FFT: ${channelName} (${data.sample_rate_hz.toFixed(0)} Hz, ${data.num_samples} samples)`,
      pad.left,
      12
    );
  }, [data, channelName]);

  if (!refLap) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-muted-foreground text-sm"
        style={{ height }}
      >
        Select a lap to view FFT
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-[#0c0c0c] rounded-lg text-red-400 text-sm"
        style={{ height }}
      >
        {error}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height }}
    />
  );
}
