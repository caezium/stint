"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface Props {
  text: string;
}

export function MessageActions({ text }: Props) {
  const [copied, setCopied] = useState(false);

  if (!text) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard might be unavailable in some contexts (insecure http etc.)
    }
  }

  return (
    <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground p-1 rounded"
        title="Copy message"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}
