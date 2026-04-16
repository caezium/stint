"use client";

import { useEffect, useState } from "react";
import {
  fetchAnomalies,
  recomputeAnomalies,
  type Anomaly,
  type AnomalyResponse,
  type AnomalySeverity,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  sessionId: string;
}

const SEVERITY_ORDER: AnomalySeverity[] = ["critical", "warning", "info"];

function severityStyle(severity: AnomalySeverity): string {
  switch (severity) {
    case "critical":
      return "border-l-2 border-l-red-500 bg-red-500/5";
    case "warning":
      return "border-l-2 border-l-amber-500 bg-amber-500/5";
    case "info":
    default:
      return "border-l-2 border-l-muted-foreground/40 bg-muted/30";
  }
}

function severityLabel(severity: AnomalySeverity): { label: string; variant: "destructive" | "outline" | "secondary"; className?: string } {
  switch (severity) {
    case "critical":
      return { label: "CRITICAL", variant: "destructive" };
    case "warning":
      return {
        label: "WARNING",
        variant: "outline",
        className: "border-amber-500/50 text-amber-400",
      };
    case "info":
    default:
      return { label: "INFO", variant: "secondary" };
  }
}

export function AnomalyPanel({ sessionId }: Props) {
  const [data, setData] = useState<AnomalyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnomalies(sessionId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleRecompute() {
    setRecomputing(true);
    setError(null);
    try {
      const next = await recomputeAnomalies(sessionId);
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  const total = data ? data.counts.critical + data.counts.warning + data.counts.info : 0;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">Anomaly watchdog</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated statistical checks on channel data.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? "Scanning…" : "Rescan"}
          </Button>
        </div>

        {loading && (
          <div className="text-xs text-muted-foreground py-2">Loading…</div>
        )}

        {error && (
          <div className="text-xs text-destructive py-2">{error}</div>
        )}

        {!loading && !error && data && total === 0 && (
          <div className="text-xs text-muted-foreground py-4 text-center">
            <span className="text-green-400">✓</span> No anomalies detected in this session.
          </div>
        )}

        {!loading && !error && data && total > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.counts.critical > 0 && (
              <Badge variant="destructive" className="text-xs">
                {data.counts.critical} critical
              </Badge>
            )}
            {data.counts.warning > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-amber-500/50 text-amber-400"
              >
                {data.counts.warning} warning{data.counts.warning > 1 ? "s" : ""}
              </Badge>
            )}
            {data.counts.info > 0 && (
              <Badge variant="secondary" className="text-xs">
                {data.counts.info} note{data.counts.info > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        )}

        {!loading && !error && data && total > 0 && (
          <div className="space-y-1.5 pt-1">
            {SEVERITY_ORDER.flatMap((sev) =>
              data.items
                .filter((a) => a.severity === sev)
                .map((a: Anomaly) => {
                  const sl = severityLabel(a.severity);
                  return (
                    <div
                      key={a.id}
                      className={`rounded-sm px-3 py-2 text-sm ${severityStyle(a.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-foreground leading-snug">
                            {a.message}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                            <Badge
                              variant={sl.variant}
                              className={`text-[10px] h-4 ${sl.className ?? ""}`}
                            >
                              {sl.label}
                            </Badge>
                            <span className="font-mono">{a.type}</span>
                            {a.channel && <span>· {a.channel}</span>}
                            {a.lap_num != null && <span>· lap {a.lap_num}</span>}
                            {a.metric_value != null && (
                              <span>· {formatMetric(a.type, a.metric_value)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatMetric(type: string, value: number): string {
  if (type.startsWith("cooling")) return `${value.toFixed(1)}°C${type === "cooling_trend" ? "/lap" : ""}`;
  if (type.startsWith("voltage")) return `${value.toFixed(1)}V`;
  if (type === "pace_decay") return `+${value.toFixed(0)}ms/lap`;
  if (type === "lap_inconsistency") return `${value.toFixed(1)}% COV`;
  if (type === "sensor_flatline") return `${value.toFixed(0)} samples`;
  if (type === "rpm_dropout") return `${value.toFixed(0)} drops`;
  return value.toFixed(2);
}
