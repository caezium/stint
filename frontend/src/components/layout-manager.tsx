"use client";

import { useState, useEffect } from "react";
import { fetchLayouts, saveLayout, deleteLayout, type Layout } from "@/lib/api";

interface LayoutManagerProps {
  /** Current chart config to save */
  currentConfig: object;
  /** Called when user loads a layout */
  onLoad: (config: object) => void;
}

export function LayoutManager({ currentConfig, onLoad }: LayoutManagerProps) {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchLayouts().then(setLayouts).catch(() => setLayouts([]));
    }
  }, [open]);

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      await saveLayout(saveName.trim(), currentConfig);
      const updated = await fetchLayouts();
      setLayouts(updated);
      setSaveName("");
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (layout: Layout) => {
    try {
      const config = JSON.parse(layout.config_json);
      onLoad(config);
      setOpen(false);
    } catch {
      // invalid JSON
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLayout(id);
      setLayouts((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // silently fail
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Layouts
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-card border border-border rounded-md shadow-lg p-3 min-w-[220px] space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Saved Layouts
            </h4>

            {layouts.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No layouts saved</p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {layouts.map((layout) => (
                  <div
                    key={layout.id}
                    className="flex items-center gap-1 text-xs"
                  >
                    <button
                      onClick={() => handleLoad(layout)}
                      className="flex-1 text-left px-2 py-1 rounded hover:bg-muted transition-colors text-foreground"
                    >
                      {layout.name}
                    </button>
                    <button
                      onClick={() => handleDelete(layout.id)}
                      className="px-1 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-2 flex gap-1">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Layout name..."
                className="flex-1 px-2 py-1 bg-muted border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <button
                onClick={handleSave}
                disabled={saving || !saveName.trim()}
                className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
