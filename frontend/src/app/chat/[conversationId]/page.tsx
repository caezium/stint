"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ChevronLeft,
  Download,
  ExternalLink,
} from "lucide-react";
import {
  fetchChatConversation,
  fetchChatSuggestions,
  type ChatConversation,
  type ChatUIMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/chat/message";
import { MultimodalInput } from "@/components/chat/multimodal-input";

export default function ChatConversationPage() {
  const params = useParams();
  const conversationId = Number(params.conversationId);

  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [seed, setSeed] = useState<UIMessage[]>([]);
  const [seedLoaded, setSeedLoaded] = useState(false);
  const [seedToolSummaries, setSeedToolSummaries] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSeedLoaded(false);
    setSeed([]);
    setSeedToolSummaries({});
    setConversation(null);
    if (!conversationId) return;
    fetchChatConversation(conversationId)
      .then((data) => {
        setConversation(data.conversation);
        setSeed(data.messages as unknown as UIMessage[]);
        const summaries: Record<string, string> = {};
        for (const m of data.messages as ChatUIMessage[]) {
          for (const p of m.parts ?? []) {
            if (p.toolCallId && p.summary) summaries[p.toolCallId] = p.summary;
          }
        }
        setSeedToolSummaries(summaries);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setSeedLoaded(true));
  }, [conversationId]);

  if (!seedLoaded) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading conversation…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive text-sm">
        {error}
      </div>
    );
  }

  // Mount the chat UI ONLY after seed is loaded so useChat initializes with
  // the real messages (it ignores subsequent `messages` prop changes).
  return (
    <ChatView
      conversation={conversation}
      conversationId={conversationId}
      seed={seed}
      seedToolSummaries={seedToolSummaries}
    />
  );
}

interface ChatViewProps {
  conversation: ChatConversation | null;
  conversationId: number;
  seed: UIMessage[];
  seedToolSummaries: Record<string, string>;
}

function ChatView({
  conversation,
  conversationId,
  seed,
  seedToolSummaries,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toolSummaries, setToolSummaries] = useState(seedToolSummaries);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!conversation?.session_id) return;
    fetchChatSuggestions(conversation.session_id).then((s) => {
      if (s.length) setSuggestions(s);
    });
  }, [conversation?.session_id]);

  const convIdRef = useRef<number | null>(conversationId);
  useEffect(() => {
    convIdRef.current = conversationId;
  }, [conversationId]);

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
          return {
            body: {
              ...body,
              conversation_id: convIdRef.current,
              message: text,
              context: null,
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: `conv-${conversationId}`,
    messages: seed,
    transport,
    onError: (e) => setError(e.message),
    onData: (part) => {
      if (part.type === "data-tool-summary") {
        const data = part.data as { toolCallId: string; summary: string };
        if (data?.toolCallId && data?.summary) {
          setToolSummaries((prev) => ({ ...prev, [data.toolCallId]: data.summary }));
        }
      }
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  async function handleSubmit() {
    const text = input.trim();
    if (!text) return;
    setError(null);
    setInput("");
    try {
      await sendMessage({ text });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-border/40 px-5 flex items-center gap-3 shrink-0">
        <Link href="/chat">
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">
            {conversation?.title || `Chat ${conversationId}`}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {conversation?.session_venue || "unknown session"}
            {conversation?.session_log_date && ` · ${conversation.session_log_date}`}
            {conversation?.session_driver && ` · ${conversation.session_driver}`}
          </div>
        </div>
        {conversation?.session_id && (
          <Link href={`/sessions/${conversation.session_id}`}>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <ExternalLink className="h-3 w-3" />
              Open session
            </Button>
          </Link>
        )}
        <a
          href={`/api/chat/conversations/${conversationId}/export.md`}
          target="_blank"
          rel="noopener"
        >
          <Button variant="ghost" size="sm" className="h-8 gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </a>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 min-w-0">
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.length === 0 && (
            <div className="py-16 text-center space-y-3">
              <div className="text-sm text-muted-foreground">
                Start the conversation.
              </div>
              {suggestions.length > 0 && (
                <div className="mx-auto max-w-md space-y-1 text-left">
                  {suggestions.slice(0, 5).map((text, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(text)}
                      className="w-full text-left rounded border border-border bg-muted/30 hover:bg-muted/60 px-3 py-2 text-xs text-foreground"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              sessionId={conversation?.session_id ?? ""}
              toolSummaries={toolSummaries}
            />
          ))}

          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs px-3 py-2">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="max-w-3xl mx-auto w-full">
        <MultimodalInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onStop={() => stop()}
          status={status}
        />
      </div>
    </div>
  );
}
