"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchSessionNotes, saveSessionNotes } from "@/lib/api";

interface SessionNotesProps {
  sessionId: string;
}

export function SessionNotes({ sessionId }: SessionNotesProps) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchSessionNotes(sessionId)
      .then((n) => setText(n.note_text || ""))
      .catch(() => setText(""));
  }, [sessionId]);

  const doSave = useCallback(
    async (value: string) => {
      try {
        await saveSessionNotes(sessionId, value);
        setSaved(true);
      } catch {
        // silently fail
      }
    },
    [sessionId]
  );

  const handleChange = (value: string) => {
    setText(value);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(value), 1000);
  };

  const handleBlur = () => {
    if (!saved) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      doSave(text);
    }
  };

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors bg-zinc-900/50"
      >
        <span
          className={`transition-transform text-[10px] ${collapsed ? "rotate-0" : "rotate-90"}`}
        >
          &#9654;
        </span>
        Session Notes
        {!saved && (
          <span className="ml-auto text-[10px] text-yellow-500">unsaved</span>
        )}
        {saved && text.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            {text.length} chars
          </span>
        )}
      </button>
      {!collapsed && (
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add session notes, setup changes, weather conditions..."
          rows={4}
          className="w-full px-3 py-2 bg-transparent border-t border-zinc-800 text-xs text-foreground focus:outline-none resize-y min-h-[60px]"
        />
      )}
    </div>
  );
}
