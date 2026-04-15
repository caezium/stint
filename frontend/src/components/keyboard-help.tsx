"use client";

import { useEffect, useRef, useState } from "react";

const SHORTCUTS: [string, string][] = [
  ["Esc", "Reset zoom"],
  ["← / →", "Step cursor 50 ms"],
  ["Shift + ← / →", "Step cursor 500 ms"],
  ["t", "Time axis"],
  ["d", "Distance axis"],
  ["1 – 9", "Set reference lap"],
  ["Shift + 1 – 9", "Toggle extra lap"],
];

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Keyboard shortcuts"
        className="bg-muted hover:bg-muted/80 rounded px-2 py-0.5 text-xs text-foreground"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[220px] rounded-md border border-border bg-background shadow-lg p-2 text-xs">
          <div className="font-semibold mb-1.5">Keyboard shortcuts</div>
          <table className="w-full">
            <tbody>
              {SHORTCUTS.map(([key, desc]) => (
                <tr key={key}>
                  <td className="pr-3 py-0.5 font-mono text-muted-foreground whitespace-nowrap">
                    {key}
                  </td>
                  <td className="py-0.5">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
