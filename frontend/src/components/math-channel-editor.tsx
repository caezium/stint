"use client";

import { useState, useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import {
  createMathChannel,
  fetchMathChannels,
  deleteMathChannel,
  type MathChannel,
} from "@/lib/api";

interface MathChannelEditorProps {
  sessionId: string;
  onChannelCreated?: () => void;
}

const MATH_HELP = [
  { op: "+ - * /", desc: "Basic arithmetic" },
  { op: "^", desc: "Exponentiation (also **)" },
  { op: "sqrt(x)", desc: "Square root" },
  { op: "abs(x)", desc: "Absolute value" },
  { op: "sin(x) cos(x) tan(x)", desc: "Trig functions" },
  { op: "log(x) log10(x)", desc: "Natural / base-10 log" },
  { op: "exp(x)", desc: "e^x" },
  { op: "min(a, b) max(a, b)", desc: "Element-wise min/max" },
  { op: "clip(x, lo, hi)", desc: "Clamp values" },
  { op: "pi", desc: "3.14159..." },
];

export function MathChannelEditor({
  sessionId,
  onChannelCreated,
}: MathChannelEditorProps) {
  const session = useSessionStore((s) => s.session);
  const [existing, setExisting] = useState<MathChannel[]>([]);
  const [name, setName] = useState("");
  const [formula, setFormula] = useState("");
  const [units, setUnits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Load existing math channels
  useEffect(() => {
    fetchMathChannels(sessionId)
      .then(setExisting)
      .catch(() => setExisting([]));
  }, [sessionId]);

  const handleCreate = async () => {
    if (!name.trim() || !formula.trim()) {
      setError("Name and formula are required");
      return;
    }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await createMathChannel(sessionId, name.trim(), formula, units);
      setSuccess(`Created "${result.name}" with ${result.sample_count} samples`);
      setName("");
      setFormula("");
      setUnits("");
      // Refresh list
      const updated = await fetchMathChannels(sessionId);
      setExisting(updated);
      onChannelCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (chName: string) => {
    try {
      await deleteMathChannel(sessionId, chName);
      setExisting((prev) => prev.filter((c) => c.name !== chName));
      onChannelCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const insertChannel = (chName: string) => {
    const safe = chName.replace(/ /g, "_").replace(/\//g, "_");
    setFormula((prev) => prev + safe);
  };

  const channels = session?.channels ?? [];

  return (
    <div className="space-y-3">
      {/* Existing math channels */}
      {existing.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Existing Math Channels
          </h4>
          {existing.map((mc) => (
            <div
              key={mc.name}
              className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/50 rounded text-xs"
            >
              <span className="font-mono text-purple-400 font-medium">
                {mc.name}
              </span>
              <span className="text-muted-foreground truncate flex-1">
                = {mc.formula}
              </span>
              {mc.units && (
                <span className="text-muted-foreground/60">[{mc.units}]</span>
              )}
              <button
                onClick={() => handleDelete(mc.name)}
                className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create new */}
      <div className="space-y-2 p-3 bg-zinc-900/30 rounded-lg border border-zinc-800">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          New Math Channel
        </h4>

        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name (e.g. G_Total)"
            className="flex-1 px-2 py-1.5 bg-muted border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="Units"
            className="w-20 px-2 py-1.5 bg-muted border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="relative">
          <textarea
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="Formula (e.g. sqrt(GPS_LateralAcc^2 + GPS_InlineAcc^2))"
            rows={2}
            className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        {/* Channel insertion quick-picks */}
        <div className="flex flex-wrap gap-1">
          {channels
            .filter((c) => c.sample_count > 10)
            .slice(0, 12)
            .map((c) => (
              <button
                key={c.name}
                onClick={() => insertChannel(c.name)}
                className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title={`Insert ${c.name}`}
              >
                {c.name}
              </button>
            ))}
          {channels.length > 12 && (
            <span className="text-[10px] text-muted-foreground/50 self-center">
              +{channels.length - 12} more
            </span>
          )}
        </div>

        {/* Help toggle */}
        <div>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHelp ? "Hide" : "Show"} formula help
          </button>
          {showHelp && (
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
              {MATH_HELP.map((h) => (
                <div key={h.op} className="flex gap-2">
                  <span className="font-mono text-purple-400/80">{h.op}</span>
                  <span className="text-muted-foreground">{h.desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim() || !formula.trim()}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating..." : "Create Channel"}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {success && <p className="text-green-400 text-xs">{success}</p>}
        </div>
      </div>
    </div>
  );
}
