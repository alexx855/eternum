import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION_MESSAGE, buildAutomationScope } from "../utils/automation-ownership";
import { installAutomationOwnership } from "../utils/automation-ownership-background";
const state = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  message: null as unknown as (message: unknown, sender: unknown) => Promise<{ error?: string }>,
  removed: null as unknown as (tabId: number) => void,
  updated: null as unknown as (tabId: number, change: { status: string }) => void,
}));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      session: {
        get: async () => structuredClone(state.stored),
        set: async (value: unknown) => {
          state.stored = structuredClone(value) as Record<string, unknown>;
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (listener: unknown) => {
          state.message = listener;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (listener: unknown) => {
          state.removed = listener;
        },
      },
      onUpdated: {
        addListener: (listener: unknown) => {
          state.updated = listener;
        },
      },
    },
  },
}));
const scope = buildAutomationScope("https://rpc", "0x123", 39, "0x1");
function request(tabId: number, operation = "claim", key = scope, documentId = `doc-${tabId}`) {
  return state.message(
    { type: AUTOMATION_MESSAGE, request: { id: "1", operation, scope: key } },
    { tab: { id: tabId }, documentId, url: "https://play.realms.party/play/madara/demo/map" },
  );
}
beforeEach(() => {
  state.stored = {};
  installAutomationOwnership();
});
describe("automation ownership across tabs", () => {
  it("allows one simultaneous owner, with independent accounts and games", async () => {
    const results = await Promise.all([request(1), request(2)]);
    expect(results[0]).toEqual({});
    expect(results[1].error).toContain("another tab");
    expect(await request(2, "claim", buildAutomationScope("https://rpc", "0x123", 39, "0x2"))).toEqual({});
    expect(await request(2, "claim", buildAutomationScope("https://rpc", "0x123", 40, "0x1"))).toEqual({});
  });
  it("retains ownership until all runs and pending confirmations release", async () => {
    await request(1);
    await request(1);
    await request(2, "release");
    await request(1, "release");
    expect((await request(2)).error).toContain("another tab");
    await request(1, "release");
    expect(await request(2)).toEqual({});
  });
  it("survives worker restart", async () => {
    await request(1);
    installAutomationOwnership();
    expect((await request(2)).error).toContain("another tab");
  });
  it("releases closed/navigated tabs and ignores releases from old documents", async () => {
    await request(1);
    state.removed(1);
    expect(await request(2)).toEqual({});
    state.updated(2, { status: "loading" });
    expect(await request(2, "claim", scope, "new-doc")).toEqual({});
    await request(2, "release");
    expect((await request(1)).error).toContain("another tab");
  });
  it("normalizes padded addresses", () => {
    expect(buildAutomationScope("https://rpc/", "0x0123", 39, "0x01")).toBe(scope);
  });
});
