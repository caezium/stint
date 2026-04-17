import { create } from "zustand";

export type DockEdge = "right" | "bottom";

interface ChatStore {
  /** Whether the chat panel is open. */
  open: boolean;
  setOpen: (open: boolean) => void;

  /** Currently-selected conversation. */
  activeConversationId: number | null;
  setActiveConversationId: (id: number | null) => void;

  /** Where the chat panel is docked when shown alongside the analysis workspace. */
  dockEdge: DockEdge;
  setDockEdge: (edge: DockEdge) => void;

  /** Pending text injected by the analysis-workspace right-click context menu. */
  pendingPrompt: string | null;
  setPendingPrompt: (text: string | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
  dockEdge: "right",
  setDockEdge: (edge) => set({ dockEdge: edge }),
  pendingPrompt: null,
  setPendingPrompt: (text) => set({ pendingPrompt: text }),
}));
