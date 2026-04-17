"use client";

import { HelpCircle } from "lucide-react";
import { explainStat } from "@/lib/stat-glossary";
import { useChatStore } from "@/stores/chat-store";

interface Props {
  /** Glossary key — e.g. "throttle_smoothness". */
  stat: string;
  /** Human-friendly stat name to use in the chat pre-fill. */
  label?: string;
}

/**
 * Tiny `?` icon that explains a stat (tooltip via `title`) and on click
 * opens the chat panel pre-filled with "Explain my {stat} for this session."
 */
export function ExplainButton({ stat, label }: Props) {
  const setOpen = useChatStore((s) => s.setOpen);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);
  const explanation = explainStat(stat);
  if (!explanation) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setPendingPrompt(`Explain my ${label ?? stat.replace(/_/g, " ")} for this session.`);
        setOpen(true);
      }}
      title={explanation}
      aria-label={`Explain ${label ?? stat}`}
      className="inline-flex items-center text-muted-foreground/60 hover:text-foreground transition-colors"
    >
      <HelpCircle className="h-3 w-3" />
    </button>
  );
}
