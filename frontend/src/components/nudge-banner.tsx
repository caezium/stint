"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import {
  dismissSessionNudge,
  fetchSessionNudge,
  type ProactiveNudge,
} from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";

interface Props {
  sessionId: string;
}

const TONE: Record<ProactiveNudge["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive-foreground",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-muted/40",
};

export function NudgeBanner({ sessionId }: Props) {
  const [nudge, setNudge] = useState<ProactiveNudge | null>(null);
  const setOpen = useChatStore((s) => s.setOpen);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);

  useEffect(() => {
    let cancelled = false;
    fetchSessionNudge(sessionId).then((n) => {
      if (!cancelled) setNudge(n);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!nudge) return null;

  function open() {
    if (!nudge) return;
    setPendingPrompt(nudge.prompt);
    setOpen(true);
  }

  async function dismiss() {
    setNudge(null);
    await dismissSessionNudge(sessionId);
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 mb-4 ${TONE[nudge.severity]}`}
    >
      <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{nudge.headline}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{nudge.detail}</div>
        <button
          onClick={open}
          className="text-xs underline text-primary hover:text-primary/80 mt-1"
        >
          Chat about this →
        </button>
      </div>
      <button
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground p-1"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
