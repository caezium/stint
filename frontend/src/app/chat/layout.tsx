"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, MessageSquare, Plus } from "lucide-react";
import {
  createChatConversation,
  deleteChatConversation,
  listAllChatConversations,
  type ChatConversation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * Layout for the dedicated /chat experience: left rail with conversations
 * grouped by session (folder-style), main pane is whatever the route renders.
 */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const params = useParams();
  const router = useRouter();
  const activeId = params.conversationId ? Number(params.conversationId) : null;

  const [convs, setConvs] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  async function reload() {
    setLoading(true);
    try {
      const rows = await listAllChatConversations();
      setConvs(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, [pathname]);

  // Group by session_id, preserving newest-first order
  const grouped = useMemo(() => {
    const acc = new Map<
      string,
      {
        session_id: string;
        session_venue: string | null | undefined;
        session_driver: string | null | undefined;
        session_log_date: string | null | undefined;
        items: ChatConversation[];
      }
    >();
    for (const c of convs) {
      const key = c.session_id;
      if (!acc.has(key)) {
        acc.set(key, {
          session_id: key,
          session_venue: c.session_venue,
          session_driver: c.session_driver,
          session_log_date: c.session_log_date,
          items: [],
        });
      }
      acc.get(key)!.items.push(c);
    }
    return Array.from(acc.values());
  }, [convs]);

  function toggle(sessionId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  async function handleDelete(id: number) {
    await deleteChatConversation(id);
    if (activeId === id) router.push("/chat");
    reload();
  }

  return (
    <div className="h-[calc(100vh)] flex">
      {/* Conversation list rail */}
      <aside className="w-[280px] shrink-0 border-r border-border/40 bg-card/30 flex flex-col">
        <div className="h-14 flex items-center justify-between px-4 border-b border-border/40">
          <div>
            <div className="text-sm font-semibold">Chat history</div>
            <div className="text-[10px] text-muted-foreground">
              Grouped by session
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-2">
          {loading && (
            <div className="text-xs text-muted-foreground py-3 px-2">
              Loading…
            </div>
          )}
          {!loading && grouped.length === 0 && (
            <div className="text-xs text-muted-foreground py-3 px-2">
              No conversations yet.
              <br />
              Ask Stint about a session to start one.
            </div>
          )}
          {grouped.map((g) => {
            const isOpen = !collapsed.has(g.session_id);
            const title =
              (g.session_venue || "Unknown session") +
              (g.session_log_date ? ` · ${g.session_log_date}` : "");
            return (
              <div key={g.session_id}>
                <button
                  type="button"
                  onClick={() => toggle(g.session_id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <span className="flex-1 truncate font-medium">{title}</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {g.items.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="pl-4 space-y-0.5">
                    <NewConvoButton
                      sessionId={g.session_id}
                      onCreated={reload}
                    />
                    {g.items.map((c) => (
                      <div
                        key={c.id}
                        className={`group relative rounded px-2 py-1 text-xs flex items-center gap-1 ${
                          activeId === c.id
                            ? "bg-primary/15 text-foreground"
                            : "text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        <MessageSquare className="h-3 w-3 shrink-0" />
                        <Link
                          href={`/chat/${c.id}`}
                          className="flex-1 min-w-0 truncate"
                          title={c.title || `Chat ${c.id}`}
                        >
                          {c.title || `Chat ${c.id}`}
                        </Link>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-red-400 text-[10px] px-1"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main pane */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function NewConvoButton({
  sessionId,
  onCreated,
}: {
  sessionId: string;
  onCreated: () => void;
}) {
  const router = useRouter();
  async function create() {
    const conv = await createChatConversation(sessionId, "New chat");
    onCreated();
    router.push(`/chat/${conv.id}`);
  }
  return (
    <button
      onClick={create}
      className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
    >
      <Plus className="h-3 w-3" />
      New chat for this session
    </button>
  );
}
