"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchSessionTags } from "@/lib/api";

interface Props {
  sessionId: string;
  /** If provided, skip the per-session fetch and render directly. */
  tags?: string[];
}

export const TAG_STYLE: Record<string, string> = {
  "personal-best":
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20",
  "clean": "bg-blue-500/15 text-blue-300 border-blue-500/30 hover:bg-blue-500/20",
  "inconsistent":
    "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20",
  "mechanical-concerns":
    "bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/20",
};

export const TAG_LABEL: Record<string, string> = {
  "personal-best": "Personal best",
  "clean": "Clean session",
  "inconsistent": "Inconsistent",
  "mechanical-concerns": "Mechanical",
};

export function SessionTagBadges({ sessionId, tags: tagsProp }: Props) {
  const [tags, setTags] = useState<string[]>(tagsProp ?? []);
  useEffect(() => {
    if (tagsProp !== undefined) {
      setTags(tagsProp);
      return;
    }
    let cancelled = false;
    fetchSessionTags(sessionId).then((t) => {
      if (!cancelled) setTags(t);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, tagsProp]);
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Badge
          key={t}
          variant="outline"
          className={`text-[10px] ${TAG_STYLE[t] ?? ""}`}
        >
          {TAG_LABEL[t] ?? t}
        </Badge>
      ))}
    </div>
  );
}
