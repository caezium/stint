import { create } from "zustand";

/**
 * Snapshot of the analysis workspace state that is shipped with each chat
 * turn so the LLM knows what the user is currently looking at (T3.1).
 */
export interface ChatContextSnapshot {
  pinned_lap?: number | null;
  pinned_distance_m?: number | null;
  visible_channels?: string[];
  zoom_range?: [number, number] | null;
}

interface ChatContextStore extends ChatContextSnapshot {
  setContext: (next: Partial<ChatContextSnapshot>) => void;
  clear: () => void;
}

export const useChatContextStore = create<ChatContextStore>((set) => ({
  pinned_lap: null,
  pinned_distance_m: null,
  visible_channels: [],
  zoom_range: null,
  setContext: (next) => set((s) => ({ ...s, ...next })),
  clear: () =>
    set({
      pinned_lap: null,
      pinned_distance_m: null,
      visible_channels: [],
      zoom_range: null,
    }),
}));
