import { afterEach, describe, expect, it, vi } from "vitest";
import { readLiveArmy } from "../utils/live-army";
import type { PageFacts, PageGameContext } from "../utils/page-game-context";

const rules = {
  game_id: 39,
  preset_id: 7,
  map_center_offset: 2147483546,
  tick_config: { armies_tick_in_seconds: 10n },
  troop_stamina_config: {
    stamina_initial: 60,
    stamina_gain_per_tick: 10,
    stamina_knight_max: 100,
    stamina_paladin_max: 120,
    stamina_crossbowman_max: 80,
    stamina_bonus_value: 5,
    stamina_explore_stamina_cost: 30,
    stamina_travel_stamina_cost: 10,
  },
};
function army(): PageFacts["ExplorerTroops"] {
  return {
    game_id: 39,
    explorer_id: 20,
    owner: 10,
    coord: { alt: false, x: 100, y: 100 },
    troops: {
      category: "Paladin",
      tier: "T2",
      count: 50_000_000_000n,
      stamina: { amount: 20n, settled_at: 980, remainder: 0 },
      boosts: { incr_stamina_regen_percent_num: 5_000, incr_stamina_regen_seconds_left: 10 },
    },
  } as PageFacts["ExplorerTroops"];
}
interface ComponentFields {
  [key: string]: Map<number, unknown> | ComponentFields;
}
function component(row: Record<string, unknown>): ComponentFields {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value && typeof value === "object" ? component(value as Record<string, unknown>) : new Map([[0, value]]),
    ]),
  );
}
function context(row: PageFacts["ExplorerTroops"]): PageGameContext {
  return {
    network: {
      provider: { gameId: 39 },
      contractComponents: {
        GameRegistry: { values: component({ game_id: 39, preset_id: 7 }) },
        PresetConfig: { values: component(rules) },
        ExplorerTroops: { values: component(row as unknown as Record<string, unknown>) },
        TileOpt: { values: component({ game_id: 39, alt: false, col: 101, row: 100, data: 5n << 41n }) },
      },
    },
    account: { account: { address: "0x1" } },
    systemCalls: {},
  };
}
afterEach(() => vi.useRealTimers());
describe("live army requirements", () => {
  it("uses the active preset and canonical boosted stamina, tier maximum and biome cost", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const row = army();
    const result = readLiveArmy(context(row), row);
    expect(result.readiness).toMatchObject({ current: 45, max: 140, exploreCost: 30, position: { col: 0, row: 0 } });
    expect(result.readiness?.travelCosts[0]).toBe(5);
    expect(result.readiness?.travelCosts[3]).toBeNull();
  });
  it("reports unavailable rules rather than inventing a stamina value", () => {
    const row = army();
    const game = context(row);
    game.network.contractComponents!.PresetConfig = { values: component({ ...rules, preset_id: 8 }) };
    expect(readLiveArmy(game, row)).toMatchObject({
      readiness: null,
      readinessError: "Game rules are not synchronized.",
    });
  });
  it("reports incomplete movement configuration instead of displaying a NaN requirement", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const row = army();
    const game = context(row);
    game.network.contractComponents!.PresetConfig = {
      values: component({
        ...rules,
        troop_stamina_config: { ...rules.troop_stamina_config, stamina_bonus_value: undefined },
      }),
    };
    expect(readLiveArmy(game, row)).toMatchObject({
      readiness: null,
      readinessError: "Movement cost configuration unavailable.",
    });
  });
  it("reads travel readiness from the native ethereal-layer neighbor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const row = army();
    row.troops.stamina = { Inline: { amount: 20n, settled_at: 980, remainder: 0 } };
    const game = context(row);
    game.store = {
      inGame: (model) =>
        ({
          SliceRules: [rules],
          TileOpt: [{ alt: true, col: 115, row: 100, data: 5n << 41n }],
          TileOccupancy: [{ entity_id: 20, alt: true, col: 100, row: 100 }],
        })[model as "SliceRules"] ?? [],
    };
    expect(readLiveArmy(game, row).readiness?.travelCosts[0]).toBe(5);
  });
  it("reads native inline stamina using the same calculation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const row = army();
    row.troops.stamina = { Inline: { amount: 20n, settled_at: 980, remainder: 0 } };
    const game = context(row);
    game.store = {
      inGame: (model) =>
        ({ SliceRules: [rules], TileOpt: [], TileOccupancy: [{ entity_id: 20, alt: false, col: 100, row: 100 }] })[
          model as "SliceRules"
        ] ?? [],
    };
    expect(readLiveArmy(game, row).readiness).toMatchObject({ current: 45, max: 140 });
  });
});
