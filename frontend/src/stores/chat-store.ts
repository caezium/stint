import { create } from "zustand";

interface ChatStore {
  /** Whether the side drawer is open. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Currently-selected conversation (null = no session selected yet). */
  activeConversationId: number | null;
  setActiveConversationId: (id: number | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),
}));
