"use client";

import type { UIMessage } from "ai";
import { Markdown } from "./markdown";
import { ToolChip } from "./tool-chip";
import { MessageActions } from "./message-actions";
import {
  LayoutProposalCard,
  MathChannelProposalCard,
} from "./proposal-cards";

interface Props {
  message: UIMessage;
  sessionId: string;
  toolSummaries?: Record<string, string>;
}

export function MessageBubble({ message, sessionId, toolSummaries }: Props) {
  const isUser = message.role === "user";

  // Concatenate text parts so the copy button captures the whole message.
  const fullText = (message.parts ?? [])
    .filter((p) => (p as { type?: string }).type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n");

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-primary/15 text-foreground border border-primary/30"
            : "bg-muted/40 text-foreground border border-border"
        }`}
      >
        <div className="space-y-2">
          {(message.parts ?? []).map((part, i) => {
            const p = part as Record<string, unknown> & { type: string };
            const t = p.type;
            if (t === "text") {
              const text = (p as unknown as { text: string }).text;
              return isUser ? (
                <div key={i} className="whitespace-pre-wrap">
                  {text}
                </div>
              ) : (
                <Markdown key={i} sessionId={sessionId}>
                  {text}
                </Markdown>
              );
            }
            if (t === "reasoning") {
              const text = (p as unknown as { text: string }).text;
              return (
                <details
                  key={i}
                  className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px]"
                >
                  <summary className="cursor-pointer text-muted-foreground">
                    reasoning
                  </summary>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {text}
                  </div>
                </details>
              );
            }
            if (typeof t === "string" && t.startsWith("tool-")) {
              const toolPart = p as Parameters<typeof ToolChip>[0]["part"];
              const cid = toolPart.toolCallId ?? "";
              const summary =
                toolPart.summary ?? (cid ? toolSummaries?.[cid] : undefined);
              const toolName = toolPart.toolName ?? t.replace(/^tool-/, "");
              return (
                <div key={i} className="space-y-1.5">
                  <ToolChip part={{ ...toolPart, summary }} />
                  {toolName === "apply_layout" && Boolean(toolPart.input) && (
                    <LayoutProposalCard
                      sessionId={sessionId}
                      input={toolPart.input as {
                        name?: string;
                        charts?: { type?: string; channels?: string[]; options?: Record<string, unknown> }[];
                      }}
                      output={toolPart.output as { status?: string; layout_id?: number } | undefined}
                    />
                  )}
                  {toolName === "apply_math_channel" && Boolean(toolPart.input) && (
                    <MathChannelProposalCard
                      sessionId={sessionId}
                      input={toolPart.input as { name?: string; expression?: string }}
                    />
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        {!isUser && fullText && <MessageActions text={fullText} />}
      </div>
    </div>
  );
}
