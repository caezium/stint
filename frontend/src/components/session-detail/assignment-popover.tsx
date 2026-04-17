"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { Driver, Vehicle } from "@/lib/api";

interface Props {
  label: "Driver" | "Vehicle";
  current: string | null | undefined;
  currentId: number | null | undefined;
  options: (Driver | Vehicle)[];
  onAssign: (id: number | null) => Promise<void> | void;
}

/**
 * Inline popover for reassigning a session's driver or vehicle without
 * taking up a whole metadata card. Closed by default; pencil icon opens a
 * custom select (base-ui dropdown, theme-matched).
 */
export function AssignmentPopover({
  label,
  current,
  currentId,
  options,
  onAssign,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleChange(value: number | string) {
    setBusy(true);
    try {
      const n = typeof value === "number" ? value : Number(value);
      await onAssign(Number.isFinite(n) && n > 0 ? n : null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const selectOptions = [
    { value: -1, label: "— Unassigned —" },
    ...options.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <div className="relative inline-flex items-center gap-1 text-sm">
      <span className="text-foreground">{current || "—"}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground/60 hover:text-foreground p-0.5"
        title={`Change ${label.toLowerCase()}`}
        aria-label={`Change ${label.toLowerCase()}`}
      >
        <Pencil className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-md border border-border bg-popover shadow-2xl p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1">
            {label}
          </div>
          <Select
            value={currentId ?? -1}
            onValueChange={(v) => handleChange(v === -1 ? "" : v)}
            disabled={busy}
            options={selectOptions}
            triggerClassName="w-full"
          />
          <button
            onClick={() => setOpen(false)}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground py-0.5"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
