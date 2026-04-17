"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  status: "submitted" | "streaming" | "ready" | "error";
  placeholder?: string;
}

export function MultimodalInput({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
  placeholder = "Ask about your session…",
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === "submitted" || status === "streaming";

  // Autosize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div className="border-t border-border p-2.5 bg-background">
      <div className="relative flex items-end gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5 focus-within:border-primary/60 transition-colors">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && value.trim()) onSubmit();
            }
          }}
          placeholder={placeholder}
          disabled={status === "submitted"}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 max-h-40"
        />
        {busy ? (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={onStop}
            title="Stop generation"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={onSubmit}
            disabled={!value.trim()}
            title="Send (Enter)"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="mt-1 px-1 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>
          {status === "streaming" ? "streaming…" : status === "submitted" ? "thinking…" : "Enter to send · Shift+Enter newline"}
        </span>
        <span>OpenRouter / Claude 4.6+</span>
      </div>
    </div>
  );
}
