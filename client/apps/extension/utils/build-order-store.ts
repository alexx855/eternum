import { create } from "zustand";
import { buildOrderJson, DEFAULT_BUILD_ORDER } from "../../../../packages/core/src/automation/build-order";
import { parseBuildOrder } from "./build-order";
import { safeGetItem, safeSetItem } from "./safe-storage";

const ORDER_KEY = "local:build-order";
const defaultJson = () => buildOrderJson(DEFAULT_BUILD_ORDER);

interface BuildOrderState {
  json: string;
  loaded: boolean;
  error?: string;
  load: () => Promise<void>;
  replace: (json: string) => Promise<void>;
  useDefault: () => Promise<void>;
}

async function persistOrder(json: string) {
  const normalized = buildOrderJson(parseBuildOrder(json));
  if (!(await safeSetItem(ORDER_KEY, normalized))) throw new Error("Order storage unavailable. Refresh the page.");
  return normalized;
}

export const useBuildOrderStore = create<BuildOrderState>((set) => ({
  json: defaultJson(),
  loaded: false,
  load: async () => {
    try {
      const saved = await safeGetItem<unknown>(ORDER_KEY);
      if (saved !== null && typeof saved !== "string") throw new Error("Saved build order could not be read.");
      const json = saved === null ? defaultJson() : buildOrderJson(parseBuildOrder(saved));
      set({ json, loaded: true, error: undefined });
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : String(error) });
    }
  },
  replace: async (json) => set({ json: await persistOrder(json), loaded: true, error: undefined }),
  useDefault: async () => set({ json: await persistOrder(defaultJson()), loaded: true, error: undefined }),
}));
