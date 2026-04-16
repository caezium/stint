"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChatConversation,
  deleteChatConversation,
  fetchChatConversation,
  listChatConversations,
  streamChatMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatToolCall,
} from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatMessageBubble } from "@/components/chat-message";

interface Props {
  sessionId: string;
}

export function ChatPanel({ sessionId }: Props) {
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId);

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ChatToolCall[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load conversation list when the panel opens
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
  }, [open, sessionId, activeConversationId, setActiveConversationId]);

  // Load messages for the active conversation
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    fetchChatConversation(activeConversationId)
      .then((data) => setMessages(data.messages))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load messages"));
  }, [activeConversationId]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, streamingToolCalls]);

  async function handleNewConversation() {
    try {
      const conv = await createChatConversation(sessionId, "New chat");
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      setMessages([]);
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
        setMessages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

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

    setSending(true);
    setError(null);
    setInput("");
    setStreamingText("");
    setStreamingToolCalls([]);

    // Optimistically append the user turn
    setMessages((prev) => [...prev, { role: "user", text }]);

    try {
      await streamChatMessage(convId, text, (evt) => {
        if (evt.type === "text_delta" && evt.delta) {
          setStreamingText((s) => s + evt.delta);
        } else if (evt.type === "tool_use" && evt.tool_use_id && evt.tool_name) {
          setStreamingToolCalls((prev) => [
            ...prev,
            {
              tool_use_id: evt.tool_use_id!,
              name: evt.tool_name!,
              input: evt.tool_input ?? {},
            },
          ]);
        } else if (evt.type === "tool_result" && evt.tool_use_id) {
          setStreamingToolCalls((prev) =>
            prev.map((tc) =>
              tc.tool_use_id === evt.tool_use_id
                ? { ...tc, output: evt.tool_output }
                : tc,
            ),
          );
        } else if (evt.type === "error" && evt.error) {
          setError(evt.error);
        }
      });

      // Finalize: reload conversation to get the persisted assistant message
      const data = await fetchChatConversation(convId);
      setMessages(data.messages);
      setStreamingText("");
      setStreamingToolCalls([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[440px] border-l border-border bg-background shadow-2xl flex flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold text-sm">Ask your data</h2>
          <p className="text-[11px] text-muted-foreground">
            Claude-powered analysis of this session
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={handleNewConversation}>
            + New
          </Button>
          <button
            className="text-muted-foreground hover:text-foreground px-2"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
          >
            ×
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

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.length === 0 && !streamingText && (
          <div className="text-center text-xs text-muted-foreground py-8 space-y-2">
            <div className="text-sm">Ask Stint about this session.</div>
            <div className="space-y-1 text-left max-w-[320px] mx-auto">
              <SuggestionChip
                text="Where am I losing the most time vs my best lap?"
                onClick={setInput}
              />
              <SuggestionChip
                text="Was lap 7 really faster or just lucky?"
                onClick={setInput}
              />
              <SuggestionChip
                text="Summarize my session in 3 sentences."
                onClick={setInput}
              />
              <SuggestionChip
                text="Any concerning trends I should know about?"
                onClick={setInput}
              />
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <ChatMessageBubble key={m.id ?? `${m.role}-${i}`} message={m} />
        ))}

        {(streamingText || streamingToolCalls.length > 0) && (
          <ChatMessageBubble
            message={{
              role: "assistant",
              text: streamingText,
              tool_calls: streamingToolCalls.length > 0 ? streamingToolCalls : undefined,
            }}
          />
        )}

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive text-xs px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about your session…"
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()} size="sm">
            {sending ? "…" : "Send"}
          </Button>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Requires OpenRouter API key in settings.
        </div>
      </div>
    </div>
  );
}

function SuggestionChip({ text, onClick }: { text: string; onClick: (s: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="w-full text-left rounded border border-border bg-muted/30 hover:bg-muted/60 px-2 py-1.5 text-[11px] text-foreground"
    >
      {text}
    </button>
  );
}
