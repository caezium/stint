import { create } from "zustand";
import { fetchChannelData } from "@/lib/api";

interface ChannelEntry {
  timecodes: number[];
  values: number[];
}

interface ChannelDataStore {
  /** keyed by `channelName` or `channelName:lapNum` */
  channels: Record<string, ChannelEntry>;
  loading: Record<string, boolean>;
  fetchChannel: (
    sessionId: string,
    channelName: string,
    lap?: number
  ) => Promise<void>;
  getChannelData: (name: string, lap?: number) => ChannelEntry | null;
  clear: () => void;
}

function cacheKey(name: string, lap?: number) {
  return lap !== undefined ? `${name}:${lap}` : name;
}

export const useChannelDataStore = create<ChannelDataStore>((set, get) => ({
  channels: {},
  loading: {},

  fetchChannel: async (sessionId, channelName, lap) => {
    const key = cacheKey(channelName, lap);
    const state = get();
    if (state.channels[key] || state.loading[key]) return;

    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      const data = await fetchChannelData(sessionId, channelName, lap);
      set((s) => ({
        channels: { ...s.channels, [key]: data },
        loading: { ...s.loading, [key]: false },
      }));
    } catch {
      set((s) => ({ loading: { ...s.loading, [key]: false } }));
    }
  },

  getChannelData: (name, lap) => {
    const key = cacheKey(name, lap);
    return get().channels[key] ?? null;
  },

  clear: () => set({ channels: {}, loading: {} }),
}));
