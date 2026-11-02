import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPageFacts,
  readPageEntityPosition,
  readPageGameConfig,
  readPageGameContext,
  readPageRealmTroops,
  isPageTileOccupied,
  type PageGameContext,
  type PageFacts,
} from "../utils/page-game-context";

const context = (values: unknown): PageGameContext => ({
  network: { provider: { gameId: 39 }, contractComponents: { Structure: { values } } },
  account: { account: { address: "0x1" } },
  systemCalls: {},
});
afterEach(() => vi.unstubAllGlobals());
describe("page game context adapter", () => {
  it("reads exact troop balances from the deployed client's Resource component", () => {
    const game = context({});
    game.network.contractComponents!.Resource = {
      values: {
        game_id: new Map([
          [0, 39],
          [1, 40],
        ]),
        entity_id: new Map([
          [0, 10],
          [1, 11],
        ]),
        KNIGHT_T1_BALANCE: new Map([
          [0, 50_000_000_000n],
          [1, 999n],
        ]),
        CROSSBOWMAN_T1_BALANCE: new Map([
          [0, 0n],
          [1, 999n],
        ]),
        PALADIN_T1_BALANCE: new Map([
          [0, 9_007_199_254_740_993n],
          [1, 999n],
        ]),
      },
    };
    expect([...readPageRealmTroops(game)]).toEqual([
      [
        10,
        [
          { resourceId: 26, balance: "50000000000" },
          { resourceId: 29, balance: "0" },
          { resourceId: 32, balance: "9007199254740993" },
        ],
      ],
    ]);
  });
  it("reads native T1 balances without consulting the deployed component", () => {
    const game = context({});
    game.store = {
      inGame: vi.fn(() => [
        { game_id: 39, entity_id: 10, resource_type: 26, balance: 50_000_000_000n },
        { game_id: 39, entity_id: 11, resource_type: 32, balance: 9_007_199_254_740_993n },
        { game_id: 39, entity_id: 10, resource_type: 27, balance: 999n },
      ]),
    };
    expect([...readPageRealmTroops(game)]).toEqual([
      [10, [{ resourceId: 26, balance: "50000000000" }]],
      [11, [{ resourceId: 32, balance: "9007199254740993" }]],
    ]);
    expect(game.store.inGame).toHaveBeenCalledWith("ResourceBalance", 39);
  });
  it("normalizes native entity IDs without converting wallet addresses", () => {
    const game = context({});
    game.store = {
      inGame: (model) =>
        model === "ExplorerTroops"
          ? [{ explorer_id: 20n, owner: 10n }]
          : [{ entity_id: 10n, owner: 0x123456789abcdefn }],
    };
    expect(readPageFacts(game, "ExplorerTroops")).toEqual([{ explorer_id: 20, owner: 10 }]);
    expect(readPageFacts(game, "Structure")).toEqual([{ entity_id: 10, owner: 0x123456789abcdefn }]);
  });
  it("rejects native IDs that would lose precision in the overlay", () => {
    const game = context({});
    game.store = { inGame: () => [{ entity_id: 9007199254740993n }] };
    expect(() => readPageFacts(game, "Structure")).toThrow("cannot be represented");
  });
  it("rejects missing troop fields instead of defaulting them to zero", () => {
    const game = context({});
    game.network.contractComponents!.Resource = {
      values: {
        game_id: new Map([[0, 39]]),
        entity_id: new Map([[0, 10]]),
        KNIGHT_T1_BALANCE: new Map([[0, 0n]]),
      },
    };
    expect(() => readPageRealmTroops(game)).toThrow("Troop balance unavailable");
  });
  it("reads positions from native occupancy and rejects missing positions", () => {
    const game = context({});
    game.store = {
      inGame: (model) => (model === "TileOccupancy" ? [{ entity_id: 10, alt: false, col: 11, row: 12 }] : []),
    };
    expect(readPageEntityPosition(game, 10)).toEqual({ alt: false, col: 11, row: 12 });
    expect(() => readPageEntityPosition(game, 99)).toThrow("position unavailable");
  });
  it("reads deployed realm coordinates from confirmed components", () => {
    const game = context({
      game_id: new Map([[0, 39]]),
      entity_id: new Map([[0, 10]]),
      base: { coord_x: new Map([[0, 11]]), coord_y: new Map([[0, 12]]), coord_alt: new Map([[0, false]]) },
    });
    game.network.contractComponents!.ExplorerTroops = { values: { game_id: new Map() } };
    expect(readPageEntityPosition(game, 10)).toEqual({ alt: false, col: 11, row: 12 });
  });
  it("reads the game's provider from the clock's ancestors", () => {
    const game = context({});
    vi.stubGlobal("document", {
      querySelector: () => ({ __reactFiber$test: { return: { memoizedProps: { value: game } } } }),
    });
    expect(readPageGameContext()).toBe(game);
  });
  it("follows React's current tree after an account or game change", () => {
    const old = context({});
    const current = context({});
    const currentRoot = { memoizedProps: { value: current } };
    const oldRoot = { memoizedProps: { value: old }, stateNode: { current: currentRoot } };
    const clockFiber = { return: oldRoot, alternate: { return: currentRoot } };
    vi.stubGlobal("document", { querySelector: () => ({ __reactFiber$test: clockFiber }) });
    expect(readPageGameContext()).toBe(current);
  });
  it("reads native deployment config from the actual provider and store readiness", () => {
    const game = context({});
    game.network.provider.contracts = { world: "0x123" };
    game.network.provider.provider = { channel: { nodeUrl: "https://rpc" } };
    game.store = { inGame: () => [], subscriptionScope: () => ({ known: { actor: "0x1" } }) };
    expect(readPageGameConfig(game)).toEqual({
      worldAddress: "0x123",
      rpcUrl: "https://rpc",
      gameId: 39,
      toriiBaseUrl: "",
      nativeStoreReady: true,
    });
    game.store.subscriptionScope = () => ({});
    expect(readPageGameConfig(game)?.nativeStoreReady).toBe(false);
  });
  it("returns unavailable when the clock or provider is missing", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    expect(readPageGameContext()).toBeNull();
    vi.stubGlobal("document", { querySelector: () => ({ __reactFiber$test: {} }) });
    expect(readPageGameContext()).toBeNull();
  });
  it("reads confirmed contract components with nested fields and filters other games", () => {
    const game = context({
      game_id: new Map([
        [0, 39],
        [1, 40],
      ]),
      entity_id: new Map([
        [0, 10],
        [1, 11],
      ]),
      base: {
        category: new Map([
          [0, 1],
          [1, 2],
        ]),
      },
      "metadata.realm_id": new Map([
        [0, 123],
        [1, 456],
      ]),
    });
    expect(readPageFacts(game, "Structure")).toEqual([
      { game_id: 39, entity_id: 10, base: { category: 1 }, metadata: { realm_id: 123 } },
    ]);
  });
  it("normalizes deployed building ownership without leaking its field alias", () => {
    const game = context({});
    game.network.contractComponents!.Building = {
      values: {
        game_id: new Map([
          [0, 39],
          [1, 40],
        ]),
        outer_entity_id: new Map([
          [0, 10],
          [1, 11],
        ]),
      },
    };
    expect(readPageFacts(game, "Building").map((row) => row.structure_id)).toEqual([10]);
  });
  it("reads occupancy through the same interface for both client layouts", () => {
    const game = context({});
    const tile = { data: 20n << 9n } as PageFacts["TileOpt"];
    expect(isPageTileOccupied(game, false, 11, 12, tile)).toBe(true);
    game.store = { inGame: () => [{ alt: false, col: 11, row: 12, entity_id: 20 }] };
    expect(isPageTileOccupied(game, false, 11, 12, { data: 0n } as PageFacts["TileOpt"])).toBe(true);
    expect(isPageTileOccupied(game, true, 11, 12, tile)).toBe(false);
  });
  it("uses the native store when available", () => {
    const game = context(null);
    const inGame = vi.fn(() => [{ game_id: 39, entity_id: 10 }]);
    game.store = { inGame };
    expect(readPageFacts(game, "Structure")).toEqual([{ game_id: 39, entity_id: 10 }]);
    expect(inGame).toHaveBeenCalledWith("Structure", 39);
  });
  it("fails loudly for missing models, game scope, and component scope", () => {
    expect(() => readPageFacts(context({}), "Building")).toThrow("Game facts unavailable");
    expect(() => readPageFacts(context({}), "Structure")).toThrow("no scope");
    const game = context({});
    game.network.provider.gameId = 0;
    expect(() => readPageFacts(game, "Structure")).toThrow("Game scope unavailable");
  });
});
