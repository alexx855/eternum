import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAllRealmArmies, LIVE_GAME_REQUEST, LIVE_GAME_RESPONSE, type LiveGameAction } from "../utils/live-game";
import { retainAutomationOwnership } from "../utils/automation-ownership";

import type { PageGameContext } from "../utils/page-game-context";
import type { WorldProfileBase } from "../utils/shared-types";
import type { LiveGameSnapshot } from "../utils/live-game";
type QueuedSigner = { signer: { execute(calls: unknown[]): Promise<unknown> } };
type TestContext = PageGameContext & { account: { account: { address: string; execute: ReturnType<typeof vi.fn> } } };
function legacyRows() {
  return {
    Structure: [{ entity_id: 10, owner: 1n, base: { category: 1, level: 0 }, metadata: { realm_id: 123 } }],
    TileOpt: [{ alt: false, col: 101, row: 99, data: 4n << 41n }],
    Building: [],
    Resource: [
      { entity_id: 10, KNIGHT_T1_BALANCE: 0n, CROSSBOWMAN_T1_BALANCE: 3_000_000_000_000n, PALADIN_T1_BALANCE: 0n },
    ],
    ExplorerTroops: [
      {
        explorer_id: 20,
        owner: 10,
        coord: { alt: false, col: 101, row: 100 },
        troops: { category: "Crossbowman", count: 50n },
      },
    ],
  };
}

const state = vi.hoisted(() => ({
  label: "10m left",
  config: null as WorldProfileBase | null,
  context: null as unknown as TestContext,
  rows: {} as ReturnType<typeof legacyRows>,
}));
vi.mock("../utils/automation-ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/automation-ownership")>()),
  retainAutomationOwnership: vi.fn(async () => vi.fn()),
}));
vi.mock("../utils/config", () => ({ parseWorldProfileBase: () => state.config }));
vi.mock("../utils/page-game-context", () => ({
  readPageGameContext: () => state.context,
  readPageGameConfig: () => state.config,
  readPageEntityPosition: (_: unknown, id: number) =>
    state.rows.Structure.some((row) => row.entity_id === id)
      ? { alt: false, col: id * 10, row: 100 }
      : { ...state.rows.ExplorerTroops.find((row) => row.explorer_id === id).coord },
  readPageFacts: (_: unknown, model: string) =>
    model === "Building"
      ? state.rows[model].map((row) => ({ ...row, structure_id: row.structure_id ?? row.outer_entity_id }))
      : state.rows[model],
  isPageTileOccupied: (_: unknown, _alt: boolean, _col: number, _row: number, tile: { data: bigint }) =>
    ((tile.data >> 9n) & 0xffffffffn) !== 0n,
  readPageRealmTroops: () =>
    new Map(
      state.rows.Resource.map((row) => [
        row.entity_id,
        [
          { resourceId: 26, balance: String(row.KNIGHT_T1_BALANCE) },
          { resourceId: 29, balance: String(row.CROSSBOWMAN_T1_BALANCE) },
          { resourceId: 32, balance: String(row.PALADIN_T1_BALANCE) },
        ],
      ]),
    ),
}));
let documentTarget: EventTarget;
let serial = 0;
const scope = JSON.stringify(["https://rpc", "123", "39", "1"]);
async function request(
  action: LiveGameAction,
  currentScope = scope,
): Promise<{ snapshot: LiveGameSnapshot; error?: string }> {
  const id = String(++serial);
  return new Promise((resolve) => {
    const handler = (event: Event) => {
      if ((event as CustomEvent).detail.id !== id) return;
      documentTarget.removeEventListener(LIVE_GAME_RESPONSE, handler);
      resolve((event as CustomEvent).detail);
    };
    documentTarget.addEventListener(LIVE_GAME_RESPONSE, handler);
    documentTarget.dispatchEvent(new CustomEvent(LIVE_GAME_REQUEST, { detail: { id, scope: currentScope, action } }));
  });
}
beforeEach(async () => {
  vi.resetModules();
  state.label = "10m left";
  state.config = {
    worldAddress: "0x123",
    rpcUrl: "https://rpc",
    heraldBaseUrl: "https://herald",
    toriiBaseUrl: "",
    gameId: 39,
  };
  state.rows = legacyRows();
  state.context = {
    network: { provider: { gameId: 39 } },
    account: { account: { address: "0x1", execute: vi.fn() } },
    systemCalls: {
      explorer_create: vi.fn(
        async ({
          for_structure_id,
          category,
          amount,
        }: {
          for_structure_id: number;
          category: number;
          amount: bigint;
        }) => {
          state.rows.ExplorerTroops.push({
            explorer_id: 20 + state.rows.ExplorerTroops.length,
            owner: for_structure_id,
            troops: { category: ["Knight", "Paladin", "Crossbowman"][category], count: amount },
          });
        },
      ),
      explorer_explore: vi.fn(async () => {
        state.rows.ExplorerTroops[0].coord.col++;
      }),
    },
  };
  documentTarget = new EventTarget();
  Object.assign(documentTarget, {
    querySelector: (selector: string) =>
      selector === ".game-finished-pill" ? null : { firstElementChild: { textContent: state.label } },
  });
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("localStorage", { getItem: () => null });
  const { installLiveGameBridge } = await import("../utils/live-game-bridge");
  installLiveGameBridge();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("live client actions", () => {
  it("does not submit a paused auto move that was waiting for ownership", async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    let grant!: () => void;
    vi.mocked(retainAutomationOwnership).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = () => resolve(release);
        }),
    );
    const starting = request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(0);
    await request({ kind: "set-auto-move-enabled", enabled: false });
    grant();
    expect((await starting).snapshot.autoMoving).toEqual([]);
    expect(state.context.systemCalls.explorer_explore).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(["stop", "pause"])("cancels a queued auto-move signer after %s", async (operation) => {
    vi.useFakeTimers();
    let executeQueued!: () => Promise<void>;
    const execute = state.context.account.account.execute;
    state.context.systemCalls.explorer_explore = ({ signer }: QueuedSigner) =>
      new Promise<void>((resolve, reject) => {
        executeQueued = async () => {
          try {
            await signer.execute([]);
            state.rows.ExplorerTroops[0].coord.col++;
            resolve();
          } catch (error) {
            reject(error);
          }
        };
      });
    const starting = request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(0);
    await request(
      operation === "stop" ? { kind: "stop", armyId: 20 } : { kind: "set-auto-move-enabled", enabled: false },
    );
    await executeQueued();
    expect((await starting).error).toContain("Auto Move stopped");
    expect(execute).not.toHaveBeenCalled();
    expect((await request({ kind: "snapshot" })).snapshot.autoMoving).toEqual([]);
  });

  it("clears a starting run after ownership is denied and permits retry", async () => {
    vi.useFakeTimers();
    vi.mocked(retainAutomationOwnership).mockRejectedValueOnce(new Error("Owned by another tab"));
    const failed = await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    expect(failed.error).toBe("Owned by another tab");
    expect((await request({ kind: "snapshot" })).snapshot.autoMoving).toEqual([]);
    expect(state.context.systemCalls.explorer_explore).not.toHaveBeenCalled();
    expect((await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true })).snapshot.autoMoving).toEqual(
      [20],
    );
    await request({ kind: "stop", armyId: 20 });
    await vi.advanceTimersByTimeAsync(5000);
  });

  it("stops an auto move before its ownership claim resolves", async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    let grant!: () => void;
    vi.mocked(retainAutomationOwnership).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = () => resolve(release);
        }),
    );
    const starting = request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(0);
    await request({ kind: "stop", armyId: 20 });
    grant();
    expect((await starting).snapshot.autoMoving).toEqual([]);
    expect(state.context.systemCalls.explorer_explore).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("stops an auto move while its first confirmation is pending", async () => {
    vi.useFakeTimers();
    let confirm!: () => void;
    state.context.systemCalls.explorer_explore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirm = () => {
            state.rows.ExplorerTroops[0].coord.col++;
            resolve();
          };
        }),
    );
    const starting = request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(0);
    await request({ kind: "stop", armyId: 20 });
    confirm();
    expect((await starting).snapshot.autoMoving).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
  });

  it("does not resume a run after observing another account and switching back", async () => {
    vi.useFakeTimers();
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    state.context.account.account.address = "0x2";
    await request({ kind: "snapshot" });
    state.context.account.account.address = "0x1";
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
    expect((await request({ kind: "snapshot" })).snapshot.autoMoving).toEqual([]);
  });

  it("master pause stops every run and prevents starting another army until enabled", async () => {
    vi.useFakeTimers();
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    const paused = await request({ kind: "set-auto-move-enabled", enabled: false });
    expect(paused.snapshot).toMatchObject({ autoMoveEnabled: false, autoMoving: [] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
    expect((await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true })).error).toContain(
      "master toggle",
    );
    await request({ kind: "set-auto-move-enabled", enabled: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
  });

  it("master pause during the first confirmation prevents the automatic loop from starting", async () => {
    vi.useFakeTimers();
    let confirm!: () => void;
    state.context.systemCalls.explorer_explore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirm = () => {
            state.rows.ExplorerTroops[0].coord.col++;
            resolve();
          };
        }),
    );
    const starting = request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(0);
    await request({ kind: "set-auto-move-enabled", enabled: false });
    await request({ kind: "set-auto-move-enabled", enabled: true });
    confirm();
    expect((await starting).snapshot.autoMoving).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
  });

  it("blocks spawning on unknown or occupied tiles", async () => {
    const action = { kind: "create-army", realmId: 10, count: 50, direction: 5 } as const;
    state.rows.TileOpt = [];
    expect((await request(action)).error).toContain("explored tile");
    state.rows.TileOpt = [{ alt: false, col: 101, row: 99, data: (4n << 41n) | (20n << 9n) }];
    expect((await request(action)).error).toContain("occupied");
    expect(state.context.systemCalls.explorer_create).not.toHaveBeenCalled();
  });
  it("reads owned realms and armies from the game facts", async () => {
    const { snapshot } = await request({ kind: "snapshot" });
    expect(snapshot.blocker).toBeNull();
    expect(snapshot.realms).toHaveLength(1);
    expect(snapshot.armies).toHaveLength(1);
  });
  it("blocks Starts in timing even when live facts exist", async () => {
    state.label = "STARTS IN 6M 09S";
    expect((await request({ kind: "snapshot" })).snapshot.blocker).toBe("before-start");
    expect((await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 })).error).toContain(
      "Game Not Started",
    );
    expect(state.context.systemCalls.explorer_create).not.toHaveBeenCalled();
  });
  it("uses the game's system call with resource precision and its connected signer", async () => {
    expect((await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 })).error).toBeUndefined();
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledWith(
      expect.objectContaining({
        for_structure_id: 10,
        category: 2,
        slot: 0,
        tier: 0,
        amount: 50_000_000_000n,
        spawn_direction: 5,
      }),
    );
  });
  it.each(["move", "create-army"])("does not repeat an unconfirmed %s before matching facts arrive", async (kind) => {
    const method = kind === "move" ? "explorer_explore" : "explorer_create";
    const original = state.context.systemCalls[method];
    const pending = vi.fn(async () => ({ status: "PENDING", transaction_hash: "0x1" }));
    state.context.systemCalls[method] = pending;
    const action =
      kind === "move"
        ? ({ kind: "move", armyId: 20, direction: 5, explore: true } as const)
        : ({ kind: "create-army", realmId: 10, count: 50, direction: 5 } as const);
    expect((await request(action)).error).toContain("confirmation unavailable");
    expect((await request(action)).error).toContain("waiting for game facts");
    expect(pending).toHaveBeenCalledTimes(1);
    if (kind === "move") state.rows.ExplorerTroops[0].coord.col++;
    else state.rows.ExplorerTroops.push({ ...state.rows.ExplorerTroops[0], explorer_id: 21 });
    state.context.systemCalls[method] = original;
    expect((await request(action)).error).toBeUndefined();
  });
  it("rechecks the clock when a queued signer actually executes", async () => {
    const execute = state.context.account.account.execute;
    state.context.systemCalls.explorer_create = async ({ signer }: QueuedSigner) => {
      state.label = "Starts in 1s";
      await signer.execute([]);
    };
    expect((await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 })).error).toContain(
      "Game Not Started",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    ["KNIGHT_T1_BALANCE", 0],
    ["PALADIN_T1_BALANCE", 1],
    ["CROSSBOWMAN_T1_BALANCE", 2],
  ])("automatically picks %s", async (field, category) => {
    state.rows.Resource[0] = {
      entity_id: 10,
      KNIGHT_T1_BALANCE: 0n,
      CROSSBOWMAN_T1_BALANCE: 0n,
      PALADIN_T1_BALANCE: 0n,
      [field]: 50_000_000_000n,
    };
    expect((await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 })).error).toBeUndefined();
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledWith(expect.objectContaining({ category }));
  });
  it("rechecks balances and rejects invalid quantities before submission", async () => {
    for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect((await request({ kind: "create-army", realmId: 10, count, direction: 5 })).error).toContain(
        "positive integer",
      );
    }
    state.rows.Resource[0].CROSSBOWMAN_T1_BALANCE = 49_999_999_999n;
    expect((await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 })).error).toContain(
      "enough T1 troops",
    );
    expect(state.context.systemCalls.explorer_create).not.toHaveBeenCalled();
  });
  it("creates across all realms with different starting troops and skips insufficient balances", async () => {
    addRealm(11, "KNIGHT_T1_BALANCE");
    addRealm(12, "PALADIN_T1_BALANCE");
    addRealm(13, "KNIGHT_T1_BALANCE", 49_999_999_999n);
    const initial = (await request({ kind: "snapshot" })).snapshot;
    const progress = vi.fn();
    const result = await createAllRealmArmies(initial, 50, 5, progress);
    expect(result).toMatchObject({ created: 3, total: 3, skipped: 1, failures: [] });
    expect(
      vi
        .mocked(state.context.systemCalls.explorer_create)
        .mock.calls.map(([props]) => [props.for_structure_id, props.category]),
    ).toEqual([
      [10, 2],
      [11, 0],
      [12, 1],
    ]);
    expect(progress).toHaveBeenCalledTimes(3);
  });
  it("reports an occupied spawn per realm and continues creating on the remaining realms", async () => {
    addRealm(11, "KNIGHT_T1_BALANCE");
    state.rows.TileOpt[0].data |= 20n << 9n;
    const result = await createAllRealmArmies((await request({ kind: "snapshot" })).snapshot, 50, 5, vi.fn());
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        realm: expect.objectContaining({ id: 10 }),
        message: expect.stringContaining("occupied"),
      }),
    ]);
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledTimes(1);
  });
  it("uses fresh balances rather than the preview and stops submissions after the account changes", async () => {
    const initial = (await request({ kind: "snapshot" })).snapshot;
    state.rows.Resource[0].CROSSBOWMAN_T1_BALANCE = 0n;
    state.rows.Resource[0].PALADIN_T1_BALANCE = 50_000_000_000n;
    const result = await createAllRealmArmies(initial, 50, 5, vi.fn());
    expect(result.created).toBe(1);
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledWith(expect.objectContaining({ category: 1 }));
    state.context.account.account.address = "0x2";
    const changed = await createAllRealmArmies(initial, 50, 5, vi.fn());
    expect(changed.created).toBe(0);
    expect(changed.failures[0].message).toContain("changed");
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledTimes(1);
  });
  it("blocks changed scope, unavailable config, and non-owned entities", async () => {
    const action = { kind: "move", armyId: 20, direction: 5, explore: true } as const;
    expect((await request(action, "stale")).error).toContain("changed");
    expect((await request({ ...action, armyId: 99 })).error).toContain("not owned");
    state.config = null;
    expect((await request(action)).error).toContain("World config unavailable");
  });
  it("does not submit remaining realms after the account changes during a bulk run", async () => {
    addRealm(11, "KNIGHT_T1_BALANCE");
    addRealm(12, "PALADIN_T1_BALANCE");
    const initial = (await request({ kind: "snapshot" })).snapshot;
    const result = await createAllRealmArmies(initial, 50, 5, (_, index) => {
      if (index === 2) state.context.account.account.address = "0x2";
    });
    expect(result.created).toBe(1);
    expect(result.failures.map(({ message }) => message)).toEqual([
      expect.stringContaining("changed"),
      expect.stringContaining("changed"),
    ]);
    expect(state.context.systemCalls.explorer_create).toHaveBeenCalledTimes(1);
    expect((await request({ kind: "snapshot" })).snapshot.scope).toBe(
      JSON.stringify(["https://rpc", "123", "39", "2"]),
    );
  });
  it("rejects a queued signer after the network changes without changing game IDs", async () => {
    state.context.systemCalls.explorer_create = vi.fn(async ({ signer }: QueuedSigner) => {
      state.config.rpcUrl = "https://other-rpc";
      await signer.execute([]);
    });
    const result = await request({ kind: "create-army", realmId: 10, count: 50, direction: 5 });
    expect(result.error).toContain("changed");
    expect(state.context.account.account.execute).not.toHaveBeenCalled();
  });

  it("exposes running and failed actions through snapshots", async () => {
    let fail!: () => void;
    state.context.systemCalls.explorer_explore = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error("Movement rejected"));
        }),
    );
    const action = request({ kind: "move", armyId: 20, direction: 5, explore: true });
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    expect((await request({ kind: "snapshot" })).snapshot.action).toMatchObject({ kind: "move", status: "running" });
    fail();
    expect((await action).error).toBe("Movement rejected");
    expect((await request({ kind: "snapshot" })).snapshot.action).toMatchObject({
      status: "failed",
      error: "Movement rejected",
    });
  });

  it("moves through the canonical client action", async () => {
    await request({ kind: "move", armyId: 20, direction: 5, explore: true });
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledWith(
      expect.objectContaining({ explorer_id: 20, directions: [5] }),
    );
  });
  it("stops automatic submissions after the account changes", async () => {
    vi.useFakeTimers();
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    state.context.account.account.address = "0x2";
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
    expect((await request({ kind: "snapshot" })).snapshot.autoMoving).toEqual([]);
  });
  it("allows restarting a stopped run without an old timer removing it", async () => {
    vi.useFakeTimers();
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await request({ kind: "stop", armyId: 20 });
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await request({ kind: "snapshot" })).snapshot.autoMoving).toEqual([20]);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(3);
    await request({ kind: "stop", armyId: 20 });
    await vi.advanceTimersByTimeAsync(5000);
  });
  it("stops auto movement before the next scheduled submission", async () => {
    vi.useFakeTimers();
    await request({ kind: "auto-move", armyId: 20, direction: 5, explore: true });
    await request({ kind: "stop", armyId: 20 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.context.systemCalls.explorer_explore).toHaveBeenCalledTimes(1);
  });
});

function addRealm(id: number, field: string, balance = 50_000_000_000n) {
  state.rows.Structure.push({ entity_id: id, owner: 1n, base: { category: 1, level: 0 }, metadata: { realm_id: 123 } });
  state.rows.Resource.push({
    entity_id: id,
    KNIGHT_T1_BALANCE: 0n,
    CROSSBOWMAN_T1_BALANCE: 0n,
    PALADIN_T1_BALANCE: 0n,
    [field]: balance,
  });
  state.rows.TileOpt.push({ alt: false, col: id * 10 + 1, row: 99, data: 4n << 41n });
}
