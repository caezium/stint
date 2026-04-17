"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string | number> {
  value: T | null | undefined;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Extra class for the trigger — use to tweak width / density. */
  triggerClassName?: string;
  id?: string;
  /** Aria-label when no visible label is present. */
  ariaLabel?: string;
}

/**
 * Custom dropdown built on @base-ui/react/select. Replaces every native
 * `<select>` in the app so dropdowns match the dark theme and look
 * consistent across platforms (macOS/Windows/Linux all got the same
 * heavy-weighted native widget before this).
 */
export function Select<T extends string | number>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  className = "",
  triggerClassName = "",
  id,
  ariaLabel,
}: Props<T>) {
  const current = options.find((o) => o.value === value);

  return (
    <BaseSelect.Root
      value={(value ?? "") as T}
      onValueChange={(v: T | null) => {
        if (v !== null) onValueChange(v);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`inline-flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/60 disabled:opacity-50 disabled:cursor-not-allowed ${triggerClassName} ${className}`}
      >
        <BaseSelect.Value>
          {current ? (
            <span className="truncate">{current.label}</span>
          ) : (
            <span className="text-muted-foreground truncate">{placeholder}</span>
          )}
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-muted-foreground/70">
          <ChevronDown className="h-3.5 w-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
          <BaseSelect.Popup
            className="min-w-[var(--anchor-width)] max-h-[min(60vh,360px)] overflow-auto rounded-md border border-border bg-popover shadow-2xl py-1 text-sm outline-none data-[open]:animate-in data-[closed]:animate-out data-[open]:fade-in-0 data-[closed]:fade-out-0 data-[open]:zoom-in-95 data-[closed]:zoom-out-95"
          >
            {options.map((o) => (
              <BaseSelect.Item
                key={String(o.value)}
                value={o.value}
                disabled={o.disabled}
                className="flex items-center gap-2 px-3 py-1.5 select-none cursor-pointer text-foreground data-[highlighted]:bg-muted/80 data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed outline-none"
              >
                <BaseSelect.ItemIndicator className="shrink-0 w-4 flex justify-center">
                  <Check className="h-3 w-3 text-primary" />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText className="flex-1 truncate">
                  {o.label}
                </BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
