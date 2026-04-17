"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  MessageSquare,
  Map,
  Settings,
  Upload,
  Users,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { StintLogo } from "@/components/stint-logo";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
  match?: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { label: "Sessions", href: "/sessions", icon: BarChart3, shortcut: "S", match: (p) => p === "/sessions" || p.startsWith("/sessions/") },
  { label: "Upload", href: "/upload", icon: Upload, shortcut: "U" },
  { label: "Drivers", href: "/drivers", icon: Users, match: (p) => p.startsWith("/drivers") },
  { label: "Tracks", href: "/tracks", icon: Map, match: (p) => p.startsWith("/tracks") },
  { label: "Chat", href: "/chat", icon: MessageSquare, match: (p) => p.startsWith("/chat") },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Left sidebar nav, 64px collapsed / 200px expanded on hover. Replaces the
 * former horizontal topbar. Fixed position, full height.
 */
export function SidebarNav() {
  const pathname = usePathname() || "";

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-40 w-[64px] hover:w-[200px] transition-[width] duration-200 ease-out border-r border-border/50 bg-card/30 backdrop-blur-sm group/nav flex flex-col"
    >
      {/* Brand */}
      <Link
        href="/sessions"
        className="h-14 flex items-center gap-2 px-4 border-b border-border/40 shrink-0"
      >
        <StintLogo size={28} markOnly />
        <span className="font-semibold tracking-tight text-foreground opacity-0 group-hover/nav:opacity-100 transition-opacity whitespace-nowrap">
          Stint
        </span>
      </Link>

      <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.match
            ? item.match(pathname)
            : pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 h-10 px-4 mx-2 my-0.5 rounded-md text-sm relative transition-colors ${
                active
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span className="opacity-0 group-hover/nav:opacity-100 transition-opacity whitespace-nowrap flex-1">
                {item.label}
              </span>
              {item.shortcut && (
                <kbd className="opacity-0 group-hover/nav:opacity-100 transition-opacity text-[9px] text-muted-foreground/60 border border-border/60 rounded px-1">
                  {item.shortcut}
                </kbd>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer / version */}
      <div className="p-3 text-[10px] text-muted-foreground/60 border-t border-border/40 shrink-0 opacity-0 group-hover/nav:opacity-100 transition-opacity">
        Stint · Telemetry coach
      </div>
    </aside>
  );
}
