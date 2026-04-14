import { create } from "zustand";
import { fetchSession, type SessionDetail } from "@/lib/api";

interface SessionStore {
  session: SessionDetail | null;
  loading: boolean;
  error: string | null;
  loadSession: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set) => ({
  session: null,
  loading: false,
  error: null,
  loadSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const session = await fetchSession(id);
      set({ session, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load session",
        loading: false,
      });
    }
  },
}));
