// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveClientOverlay } from "../entrypoints/content/overlay/LiveClientOverlay";
import { createAllRealmArmies, LIVE_GAME_RESPONSE, requestLiveGame, type LiveGameSnapshot } from "../utils/live-game";
import { ETERNUM_SHOW_OVERLAY_EVENT } from "../utils/extension-messages";

vi.mock("../utils/safe-storage", () => ({ safeGetItem: async () => null, safeSetItem: async () => true }));
vi.mock("../utils/live-game", async (original) => ({
  ...(await original<typeof import("../utils/live-game")>()),
  requestLiveGame: vi.fn(),
  createAllRealmArmies: vi.fn(),
}));
let root: Root;
let snapshot: LiveGameSnapshot;
let clock: HTMLElement;
function button(label: string) {
  const found =
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  if (!found) throw new Error(`Button unavailable: ${label}`);
  return found;
}
async function mount(visible = true) {
  await act(async () => {
    root.render(<LiveClientOverlay initialVisible={visible} />);
  });
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div aria-label="Game clock"><span>10m left</span></div><main></main>';
  clock = document.querySelector('[aria-label="Game clock"] span')!;
  snapshot = {
    scope: "game-account",
    blocker: null,
    realms: [
      { id: 10, realmId: 123, level: 0, troopBalances: [{ resourceId: 26, balance: "50000000000" }], buildings: [] },
    ],
    armies: [
      {
        id: 20,
        home: 10,
        category: "Knight",
        tier: "T1",
        count: "50000000000",
        readiness: { current: 60, max: 100, exploreCost: 30, travelCosts: {}, position: { col: 0, row: 0 } },
      },
    ],
    autoMoving: [],
    autoMoveEnabled: true,
    autoMoveSettings: {},
  };
  vi.mocked(requestLiveGame)
    .mockReset()
    .mockImplementation(async () => snapshot);
  vi.mocked(createAllRealmArmies).mockReset();
  root = createRoot(document.querySelector("main")!);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.unstubAllGlobals();
});

describe("live overlay controls", () => {
  it("mounts hidden, opens on activation, and closes on Escape", async () => {
    await mount(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(requestLiveGame).not.toHaveBeenCalled();
    await act(async () => {
      document.dispatchEvent(new CustomEvent(ETERNUM_SHOW_OVERLAY_EVENT));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("removes acting controls as soon as the real page clock changes", async () => {
    await mount();
    expect(button("Create Armies").disabled).toBe(false);
    await act(async () => {
      clock.textContent = "Starts in 1m";
    });
    expect(document.body.textContent).toContain("Game Not Started");
    expect(document.body.textContent).not.toContain("Create Armies");
    expect(createAllRealmArmies).not.toHaveBeenCalled();
  });
  it("submits one move with the displayed scope and reports bridge failures", async () => {
    await mount();
    vi.mocked(requestLiveGame).mockRejectedValueOnce(new Error("Move rejected"));
    await click("Move army 20 once");
    expect(requestLiveGame).toHaveBeenLastCalledWith(
      { kind: "move", armyId: 20, direction: 0, explore: true },
      "game-account",
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Move rejected");
  });
  it("keeps Stop and Master pause available while confirmation disables new moves", async () => {
    snapshot.action = { id: "pending", scope: snapshot.scope, kind: "move", status: "running" };
    snapshot.autoMoving = [20];
    snapshot.autoMoveSettings = { 20: { direction: 5, explore: true } };
    await mount();
    expect(button("Move army 20 once").disabled).toBe(true);
    expect(button("Auto Move for army 20").disabled).toBe(false);
    expect(button("Enable Auto Move for all armies").disabled).toBe(false);
    await click("Auto Move for army 20");
    expect(requestLiveGame).toHaveBeenLastCalledWith({ kind: "stop", armyId: 20 }, snapshot.scope);
    await click("Enable Auto Move for all armies");
    expect(requestLiveGame).toHaveBeenLastCalledWith({ kind: "set-auto-move-enabled", enabled: false }, snapshot.scope);
  });
  it("shows batch creation results and asynchronous auto-move failures", async () => {
    vi.mocked(createAllRealmArmies).mockResolvedValue({
      created: 0,
      total: 1,
      skipped: 0,
      failures: [{ realm: snapshot.realms[0], message: "Spawn tile occupied" }],
    });
    await mount();
    await click("Create Armies");
    expect(createAllRealmArmies).toHaveBeenCalledWith(snapshot, 50, 5, expect.any(Function));
    expect(document.body.textContent).toContain("Created 0 of 1 armies");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Spawn tile occupied");
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent(LIVE_GAME_RESPONSE, { detail: { id: "auto-move", error: "Army 20 stopped" } }),
      );
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Auto Move stopped: Army 20 stopped");
  });
});
