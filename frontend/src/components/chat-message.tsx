"use client";

import { useState } from "react";
import { type ChatMessage, type ChatToolCall } from "@/lib/api";

interface Props {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-primary/15 text-foreground border border-primary/30"
            : "bg-muted/40 text-foreground border border-border"
        }`}
      >
        {message.text && <div>{message.text}</div>}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.tool_calls.map((tc) => (
              <ToolCallChip key={tc.tool_use_id} call={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallChip({ call }: { call: ChatToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded border border-border bg-background/50 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-2 py-1 flex items-center gap-2 text-[11px] font-mono text-muted-foreground hover:bg-muted/60 transition-colors"
      >
        <span className="text-blue-400">⚙</span>
        <span>{call.name}</span>
        <span className="ml-auto text-[9px]">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="px-2 py-1 space-y-1 text-[10px] font-mono">
          <div>
            <div className="text-muted-foreground">input</div>
            <pre className="whitespace-pre-wrap break-words bg-black/30 rounded p-1">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          {call.output !== undefined && (
            <div>
              <div className="text-muted-foreground">output</div>
              <pre className="whitespace-pre-wrap break-words bg-black/30 rounded p-1 max-h-40 overflow-auto">
                {JSON.stringify(call.output, null, 2)}
              </pre>
            </div>
          )}
          {call.error && (
            <div className="text-destructive">error: {call.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
