import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("wxt/storage", () => ({ storage: { getItem: api.get, setItem: api.set } }));
beforeEach(() => {
  vi.resetModules();
  api.get.mockReset().mockResolvedValue("saved");
  api.set.mockReset().mockResolvedValue(undefined);
});
describe("extension storage failures", () => {
  it("reads and writes the requested key", async () => {
    const storage = await import("../utils/safe-storage");
    expect(await storage.safeGetItem("local:build-order")).toBe("saved");
    expect(await storage.safeSetItem("local:build-order", "next")).toBe(true);
    expect(api.get).toHaveBeenCalledWith("local:build-order");
    expect(api.set).toHaveBeenCalledWith("local:build-order", "next");
  });
  it("surfaces ordinary read and write errors rather than replacing saved data", async () => {
    api.get.mockRejectedValue(new Error("Read denied"));
    api.set.mockRejectedValue(new Error("Write denied"));
    const storage = await import("../utils/safe-storage");
    await expect(storage.safeGetItem("local:build-order")).rejects.toThrow("Read denied");
    await expect(storage.safeSetItem("local:build-order", "next")).rejects.toThrow("Write denied");
  });
  it("announces context invalidation once and refuses subsequent storage access", async () => {
    const document = new EventTarget();
    const invalidated = vi.fn();
    document.addEventListener("eternum-context-invalidated", invalidated);
    vi.stubGlobal("document", document);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      api.get.mockRejectedValue(new Error("Extension context invalidated"));
      const storage = await import("../utils/safe-storage");
      expect(await storage.safeGetItem("local:build-order")).toBeNull();
      expect(await storage.safeGetItem("local:build-order")).toBeNull();
      expect(await storage.safeSetItem("local:build-order", "next")).toBe(false);
      expect(invalidated).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.set).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
