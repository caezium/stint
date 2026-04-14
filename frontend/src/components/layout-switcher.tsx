"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LAYOUTS = [
  { value: "time-distance", label: "Time/Distance" },
  { value: "split-times", label: "Split Times" },
  { value: "scatter", label: "Scatter" },
  { value: "channel-report", label: "Channel Report" },
] as const;

interface LayoutSwitcherProps {
  activeLayout: string;
  onLayoutChange: (layout: string) => void;
}

export function LayoutSwitcher({
  activeLayout,
  onLayoutChange,
}: LayoutSwitcherProps) {
  return (
    <Tabs
      value={activeLayout}
      onValueChange={(value) => onLayoutChange(value as string)}
    >
      <TabsList variant="line" className="border-b border-zinc-800 w-full justify-start gap-0">
        {LAYOUTS.map((layout) => (
          <TabsTrigger
            key={layout.value}
            value={layout.value}
            className="px-4 py-2 text-sm"
          >
            {layout.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
