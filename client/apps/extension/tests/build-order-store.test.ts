import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOrderJson, DEFAULT_BUILD_ORDER } from "../../../../packages/core/src/automation/build-order";

const storage = vi.hoisted(() => ({ values: new Map<string, unknown>(), writable: true }));
vi.mock("../utils/safe-storage", () => ({
  safeGetItem: async (key: string) => storage.values.get(key) ?? null,
  safeSetItem: async (key: string, value: unknown) => {
    if (!storage.writable) return false;
    storage.values.set(key, value);
    return true;
  },
}));

beforeEach(() => {
  storage.values.clear();
  storage.writable = true;
  vi.resetModules();
});

describe("a single loaded official order", () => {
  it("starts with the official default and never reads or writes the retired preset key", async () => {
    const legacy = { version: 2, buildingPresets: [{ name: "Saved preset" }] };
    storage.values.set("local:building-presets", legacy);
    const { useBuildOrderStore: store } = await import("../utils/build-order-store");
    await store.getState().load();
    expect(store.getState()).toMatchObject({
      loaded: true,
      json: buildOrderJson(DEFAULT_BUILD_ORDER),
      error: undefined,
    });
    await store.getState().replace('{"name":"Mine","steps":[{"rank":"City","goal":"wood","count":2}]}');
    expect(storage.values.get("local:building-presets")).toBe(legacy);
    expect(storage.values.size).toBe(2);
    await store.getState().load();
    expect(JSON.parse(store.getState().json).name).toBe("Mine");
  });
  it("retains the previous order on invalid JSON, unsupported goals, or failed storage", async () => {
    const { useBuildOrderStore: store } = await import("../utils/build-order-store");
    const original = store.getState().json;
    for (const value of ["not json", '{"name":"Bad","steps":[{"rank":"City","goal":"unknown","count":1}]}']) {
      await expect(store.getState().replace(value)).rejects.toThrow();
      expect(store.getState().json).toBe(original);
    }
    storage.writable = false;
    await expect(store.getState().useDefault()).rejects.toThrow("storage unavailable");
    expect(store.getState().json).toBe(original);
  });
  it.each(["broken", { invalid: true }])(
    "requires explicit default recovery for corrupt saved data %j",
    async (saved) => {
      storage.values.set("local:build-order", saved);
      const { useBuildOrderStore: store } = await import("../utils/build-order-store");
      await store.getState().load();
      expect(store.getState().error).toBeTruthy();
      expect(storage.values.get("local:build-order")).toBe(saved);
      await store.getState().useDefault();
      expect(store.getState()).toMatchObject({ error: undefined, json: buildOrderJson(DEFAULT_BUILD_ORDER) });
    },
  );
});
