import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVATE_EXTENSION_MESSAGE, CONTENT_READY_MESSAGE, TOGGLE_OVERLAY_MESSAGE } from "../utils/extension-messages";

type Tab = { id?: number; url?: string };
const state = vi.hoisted(() => ({
  clicked: null as unknown as (tab: Tab) => void,
  message: null as unknown as (message: unknown, sender: { tab?: Tab }) => void,
  removed: null as unknown as (id: number) => void,
  updated: null as unknown as (id: number, change: { url?: string }) => void,
  send: vi.fn<(id: number, message: unknown) => Promise<void>>(),
  inject: vi.fn<(options: unknown) => Promise<void>>(),
}));
vi.mock("../utils/automation-ownership-background", () => ({ installAutomationOwnership: vi.fn() }));
vi.mock("wxt/sandbox", () => ({ defineBackground: (run: () => void) => run }));
vi.mock("wxt/browser", () => ({
  browser: {
    action: {
      onClicked: {
        addListener: (listener: typeof state.clicked) => {
          state.clicked = listener;
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (listener: typeof state.message) => {
          state.message = listener;
        },
      },
    },
    scripting: { executeScript: state.inject },
    tabs: {
      sendMessage: state.send,
      onRemoved: {
        addListener: (listener: typeof state.removed) => {
          state.removed = listener;
        },
      },
      onUpdated: {
        addListener: (listener: typeof state.updated) => {
          state.updated = listener;
        },
      },
    },
  },
}));
const tab = { id: 7, url: "https://play.realms.party/g/chain/39/map" };
beforeEach(async () => {
  vi.resetModules();
  state.send.mockReset().mockResolvedValue(undefined);
  state.inject.mockReset().mockResolvedValue(undefined);
  const { default: start } = await import("../entrypoints/background");
  (start as unknown as () => void)();
});
afterEach(() => vi.restoreAllMocks());

async function activate() {
  state.clicked(tab);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.send).toHaveBeenCalledTimes(1);
}

describe("extension activation", () => {
  it("toggles the selected client tab and restores only that tab on reload", async () => {
    await activate();
    expect(state.send).toHaveBeenCalledWith(7, { type: TOGGLE_OVERLAY_MESSAGE });
    expect(state.inject).not.toHaveBeenCalled();
    state.message({ type: CONTENT_READY_MESSAGE }, { tab: { id: 8 } });
    expect(state.send).toHaveBeenCalledTimes(1);
    state.message({ type: CONTENT_READY_MESSAGE }, { tab });
    expect(state.send).toHaveBeenLastCalledWith(7, { type: ACTIVATE_EXTENSION_MESSAGE });
  });
  it.each(["closed", "left client"])("forgets activation when the tab is %s", async (change) => {
    await activate();
    if (change === "closed") state.removed(7);
    else state.updated(7, { url: "https://example.org" });
    state.message({ type: CONTENT_READY_MESSAGE }, { tab });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it("ignores unsupported tabs, missing tab IDs and unrelated messages", () => {
    state.clicked({ ...tab, url: "https://example.org" });
    state.clicked({ url: tab.url });
    state.message({ type: CONTENT_READY_MESSAGE }, {});
    state.message(
      { type: "ETERNUM_EXTENSION_NETWORK_REQUEST", kind: "torii-sql", url: "https://example.org/sql" },
      { tab },
    );
    expect(state.send).not.toHaveBeenCalled();
    expect(state.inject).not.toHaveBeenCalled();
  });
  it("injects a missing content script without double activation on its ready announcement", async () => {
    state.send.mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."));
    state.inject.mockImplementationOnce(async () => {
      state.message({ type: CONTENT_READY_MESSAGE }, { tab });
    });
    state.clicked(tab);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.inject).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["content-scripts/content.js"] });
    expect(
      state.send.mock.calls.every(([, message]) => (message as { type: string }).type === TOGGLE_OVERLAY_MESSAGE),
    ).toBe(true);
  });
  it("reports an injection failure without marking the tab as activated", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    state.send.mockRejectedValueOnce(new Error("Receiving end does not exist"));
    state.inject.mockRejectedValueOnce(new Error("Injection denied"));
    state.clicked(tab);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    state.send.mockClear();
    state.message({ type: CONTENT_READY_MESSAGE }, { tab });
    expect(state.send).not.toHaveBeenCalled();
  });
});
