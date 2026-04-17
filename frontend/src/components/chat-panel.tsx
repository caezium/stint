"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, PanelRightOpen, PanelBottomOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/chat/message";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import {
  createChatConversation,
  deleteChatConversation,
  fetchChatConversation,
  fetchChatSuggestions,
  listChatConversations,
  type ChatConversation,
  type ChatUIMessage,
} from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { useChatContextStore } from "@/stores/chat-context-store";

interface Props {
  sessionId: string;
}

const DEFAULT_SUGGESTIONS = [
  "Where am I losing the most time vs my best lap?",
  "Was lap 7 really faster or just lucky?",
  "Summarize my session in 3 sentences.",
  "Any concerning trends I should know about?",
];

export function ChatPanel({ sessionId }: Props) {
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId);
  const pendingPrompt = useChatStore((s) => s.pendingPrompt);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);

  const ctx = useChatContextStore();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [seedMessages, setSeedMessages] = useState<UIMessage[]>([]);
  const [seedLoaded, setSeedLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toolSummaries, setToolSummaries] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load conversation list when panel opens
  useEffect(() => {
    if (!open) return;
    listChatConversations(sessionId)
      .then((list) => {
        setConversations(list);
        if (list.length > 0 && activeConversationId == null) {
          setActiveConversationId(list[0].id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load conversations"));
    fetchChatSuggestions(sessionId).then((s) => {
      if (s.length) setSuggestions(s);
    });
  }, [open, sessionId, activeConversationId, setActiveConversationId]);

  // Hydrate seed messages whenever the active conversation changes
  useEffect(() => {
    setSeedLoaded(false);
    setSeedMessages([]);
    setToolSummaries({});
    if (!activeConversationId) {
      setSeedLoaded(true);
      return;
    }
    fetchChatConversation(activeConversationId)
      .then((data) => {
        // Cast our ChatUIMessage to AI SDK's UIMessage shape (compatible)
        setSeedMessages(data.messages as unknown as UIMessage[]);
        // Pull any persisted tool summaries
        const summaries: Record<string, string> = {};
        for (const m of data.messages as ChatUIMessage[]) {
          for (const p of m.parts ?? []) {
            if (p.toolCallId && p.summary) summaries[p.toolCallId] = p.summary;
          }
        }
        setToolSummaries(summaries);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load messages"))
      .finally(() => setSeedLoaded(true));
  }, [activeConversationId]);

  // Refs so the transport closure always reads the latest values without
  // forcing the transport to be recreated (which would unmount streaming).
  const convIdRef = useRef<number | null>(activeConversationId);
  useEffect(() => {
    convIdRef.current = activeConversationId;
  }, [activeConversationId]);
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/message",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1];
          const text =
            last?.parts
              ?.filter((p) => (p as { type?: string }).type === "text")
              .map((p) => (p as { text: string }).text)
              .join("\n\n") ?? "";
          const c = ctxRef.current;
          return {
            body: {
              ...body,
              conversation_id: convIdRef.current,
              message: text,
              context: {
                pinned_lap: c.pinned_lap ?? null,
                pinned_distance_m: c.pinned_distance_m ?? null,
                visible_channels: c.visible_channels ?? [],
                zoom_range: c.zoom_range ?? null,
              },
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: activeConversationId ? `conv-${activeConversationId}` : "new",
    messages: seedLoaded ? seedMessages : undefined,
    transport,
    onError: (e) => setError(e.message),
    onData: (part) => {
      // Side-channel: tool summaries arrive as `data-tool-summary` parts
      if (part.type === "data-tool-summary") {
        const data = part.data as { toolCallId: string; summary: string };
        if (data?.toolCallId && data?.summary) {
          setToolSummaries((prev) => ({ ...prev, [data.toolCallId]: data.summary }));
        }
      }
    },
  });

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  // Pull pending prompts injected from elsewhere (chart context menu etc.)
  useEffect(() => {
    if (pendingPrompt) {
      setInput((prev) => (prev ? prev : pendingPrompt));
      setPendingPrompt(null);
    }
  }, [pendingPrompt, setPendingPrompt]);

  async function handleNewConversation() {
    try {
      const conv = await createChatConversation(sessionId, "New chat");
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create conversation");
    }
  }

  async function handleDeleteConversation(id: number) {
    try {
      await deleteChatConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text) return;

    let convId = activeConversationId;
    if (convId == null) {
      try {
        const conv = await createChatConversation(sessionId, text.slice(0, 40));
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        convId = conv.id;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create conversation");
        return;
      }
    }
    // Sync the ref before sendMessage so prepareSendMessagesRequest sees it
    convIdRef.current = convId;

    setError(null);
    setInput("");
    try {
      await sendMessage({ text });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    }
  }

  // --- T3.2: resizable + dockable -----------------------------------------

  const dockEdge = useChatStore((s) => s.dockEdge);
  const setDockEdge = useChatStore((s) => s.setDockEdge);

  const RIGHT_MIN = 320;
  const RIGHT_MAX_VW = 0.7;      // don't let the chat eat more than 70 vw
  const BOTTOM_MIN = 240;
  const BOTTOM_MAX_VH = 0.75;

  const [rightW, setRightW] = useState<number>(() => {
    if (typeof window === "undefined") return 440;
    const v = Number(window.localStorage.getItem("stint-chat-right-w"));
    return Number.isFinite(v) && v >= RIGHT_MIN ? v : 440;
  });
  const [bottomH, setBottomH] = useState<number>(() => {
    if (typeof window === "undefined") return 360;
    const v = Number(window.localStorage.getItem("stint-chat-bottom-h"));
    return Number.isFinite(v) && v >= BOTTOM_MIN ? v : 360;
  });

  useEffect(() => {
    try { window.localStorage.setItem("stint-chat-right-w", String(rightW)); } catch {}
  }, [rightW]);
  useEffect(() => {
    try { window.localStorage.setItem("stint-chat-bottom-h", String(bottomH)); } catch {}
  }, [bottomH]);

  const dragging = useRef<"right" | "bottom" | null>(null);
  const startResize = useCallback((edge: "right" | "bottom") => (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = edge;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);
  useEffect(() => {
    function move(e: PointerEvent) {
      if (!dragging.current) return;
      if (dragging.current === "right") {
        const next = Math.max(
          RIGHT_MIN,
          Math.min(window.innerWidth * RIGHT_MAX_VW, window.innerWidth - e.clientX)
        );
        setRightW(next);
      } else {
        const next = Math.max(
          BOTTOM_MIN,
          Math.min(window.innerHeight * BOTTOM_MAX_VH, window.innerHeight - e.clientY)
        );
        setBottomH(next);
      }
    }
    function up() {
      dragging.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  if (!open) return null;

  const isRight = dockEdge === "right";
  // Topbar is h-14 (56 px) sticky at top — chat panel starts below it so the
  // header controls stay visible.
  const TOPBAR = 56;
  const outerClass = isRight
    ? "fixed right-0 z-40 border-l border-border bg-background shadow-2xl flex flex-col"
    : "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background shadow-2xl flex flex-col";
  const outerStyle: React.CSSProperties = isRight
    ? {
        width: `min(100vw, ${rightW}px)`,
        top: TOPBAR,
        bottom: 0,
      }
    : { height: `min(calc(100vh - ${TOPBAR}px), ${bottomH}px)` };

  return (
    <div className={outerClass} style={outerStyle}>
      {/* Resize handle (wider hit-zone with a thin visible bar centered in it) */}
      {isRight ? (
        <div
          onPointerDown={startResize("right")}
          className="absolute left-0 top-0 bottom-0 w-3 -translate-x-1.5 cursor-col-resize z-10 group/resize"
          title="Drag to resize"
        >
          <div className="mx-auto h-full w-px bg-border group-hover/resize:bg-primary group-active/resize:bg-primary transition-colors" />
        </div>
      ) : (
        <div
          onPointerDown={startResize("bottom")}
          className="absolute top-0 left-0 right-0 h-3 -translate-y-1.5 cursor-row-resize z-10 group/resize"
          title="Drag to resize"
        >
          <div className="my-auto w-full h-px bg-border group-hover/resize:bg-primary group-active/resize:bg-primary transition-colors" />
        </div>
      )}

      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold text-sm">Ask Stint</h2>
          <p className="text-[11px] text-muted-foreground">
            Claude-powered telemetry coach for this session
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDockEdge(isRight ? "bottom" : "right")}
            className="text-muted-foreground hover:text-foreground p-1.5"
            title={isRight ? "Dock to bottom" : "Dock to right"}
            aria-label="Toggle dock edge"
          >
            {isRight ? (
              <PanelBottomOpen className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
          <Button size="sm" variant="secondary" onClick={handleNewConversation}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
          <button
            className="text-muted-foreground hover:text-foreground p-1.5"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {conversations.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-2 text-xs">
          {conversations.map((c) => (
            <div key={c.id} className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => setActiveConversationId(c.id)}
                className={`rounded px-2 py-0.5 truncate max-w-[140px] ${
                  activeConversationId === c.id
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c.title || `Chat ${c.id}`}
              </button>
              <button
                onClick={() => handleDeleteConversation(c.id)}
                className="text-muted-foreground/60 hover:text-red-400 text-[10px] px-1"
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8 space-y-2">
            <div className="text-sm">Ask Stint about this session.</div>
            <div className="space-y-1 text-left max-w-[320px] mx-auto">
              {suggestions.slice(0, 5).map((text, i) => (
                <SuggestionChip key={i} text={text} onClick={setInput} />
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            sessionId={sessionId}
            toolSummaries={toolSummaries}
          />
        ))}

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <MultimodalInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={() => stop()}
        status={status}
      />
    </div>
  );
}

function SuggestionChip({
  text,
  onClick,
}: {
  text: string;
  onClick: (s: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(text)}
      className="w-full text-left rounded border border-border bg-muted/30 hover:bg-muted/60 px-2 py-1.5 text-[11px] text-foreground"
    >
      {text}
    </button>
  );
}
