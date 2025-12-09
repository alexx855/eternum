import { create } from "zustand";
import { storage } from "wxt/storage";

interface WorldProfile {
  name: string;
  chain: string;
  toriiBaseUrl: string;
  worldAddress: string;
  contractsBySelector: Record<string, string>;
  fetchedAt: number;
}

interface ExtensionState {
  config: WorldProfile | null;
  loadConfig: () => Promise<void>;
}

export const useExtensionStore = create<ExtensionState>((set) => ({
  config: null,
  loadConfig: async () => {
    const config = await storage.getItem<WorldProfile>("local:gameConfig");
    if (config) {
      set({ config });
    }
  },
}));
