import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ install: vi.fn() }));
vi.mock("../utils/live-game-bridge", () => ({ installLiveGameBridge: bridge.install }));
vi.mock("wxt/sandbox", () => ({ defineUnlistedScript: (run: () => void) => run }));

beforeEach(() => {
  vi.resetModules();
  bridge.install.mockClear();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

it("installs one bridge across repeated injections", async () => {
  const { default: run } = await import("../entrypoints/main-world");
  (run as unknown as () => void)();
  (run as unknown as () => void)();
  expect(bridge.install).toHaveBeenCalledTimes(1);
});

it("keeps the existing bootstrap key so an extension update cannot install a second bridge", async () => {
  Object.assign(window, { __eternumExtensionMainWorldBootstrapped: true });
  const { default: run } = await import("../entrypoints/main-world");
  (run as unknown as () => void)();
  expect(bridge.install).not.toHaveBeenCalled();
});
