"use client";

import { useEffect, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionDetail } from "@/lib/api";
import { formatLapTime } from "@/lib/constants";

interface Props {
  session: SessionDetail;
  heroRef: RefObject<HTMLDivElement | null>;
  onOpenChat: () => void;
}

/**
 * Sticky sub-header that fades in once the user scrolls past the hero.
 * Pins back-link + venue/date + driver + vehicle + best-lap + chat/analysis
 * actions so the user always has the anchors while scrolling deep content.
 */
export function SessionStickyBar({ session, heroRef, onOpenChat }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        // Hero is visible → hide sticky. Hero scrolled past → show sticky.
        setShow(!entries[0].isIntersecting);
      },
      { rootMargin: "-40px 0px 0px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [heroRef]);

  return (
    <div
      className={`sticky top-0 z-30 transition-all duration-200 hidden md:block ${
        show
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-border/60 bg-background/80 backdrop-blur-md px-3 py-2 shadow-lg">
          <Link
            href="/sessions"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Sessions
          </Link>
          <div className="h-4 w-px bg-border/60" />
          <div className="text-sm truncate">
            <span className="font-medium text-foreground">
              {session.venue || "Session"}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              {session.log_date}
            </span>
          </div>
          <div className="h-4 w-px bg-border/60" />
          <div className="text-xs text-muted-foreground truncate hidden lg:block">
            <span className="text-foreground">{session.driver || "—"}</span>
            <span className="mx-1">·</span>
            <span>{session.vehicle || "—"}</span>
          </div>
          {session.best_lap_time_ms != null && session.best_lap_time_ms > 0 && (
            <div className="ml-auto font-mono tabular-nums text-sm text-emerald-300 shrink-0">
              {formatLapTime(session.best_lap_time_ms)}
            </div>
          )}
          <div className="ml-auto lg:ml-0 flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" onClick={onOpenChat}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              Chat
            </Button>
            <Link href={`/sessions/${session.id}/analysis`}>
              <Button size="sm" variant="secondary">
                Analysis
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
