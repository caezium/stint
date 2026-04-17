"use client";

import Link from "next/link";
import { MessageSquare, Sparkles } from "lucide-react";

export default function ChatIndexPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">
        Stint chat history
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        Pick a conversation from the left to pick up where you left off.
        Conversations are grouped by the session they were about.
      </p>
      <p className="text-xs text-muted-foreground mt-6">
        Don&apos;t see your session? Open it from the{" "}
        <Link href="/sessions" className="text-primary hover:underline">
          Sessions
        </Link>{" "}
        page and click <MessageSquare className="inline h-3 w-3 -mt-0.5" />{" "}
        Ask Stint.
      </p>
    </div>
  );
}
