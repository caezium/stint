"use client";

import { useChatStore } from "@/stores/chat-store";
import { Button } from "@/components/ui/button";

interface Props {
  className?: string;
}

/**
 * Floating chat toggle button. Visible when panel is closed.
 */
export function ChatToggleButton({ className }: Props) {
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);

  if (open) return null;

  return (
    <Button
      size="sm"
      onClick={() => setOpen(true)}
      className={`${className ?? ""}`}
    >
      <span className="mr-1">✨</span>Ask AI
    </Button>
  );
}
