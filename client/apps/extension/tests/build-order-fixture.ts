import { vi } from "vitest";
import { RESOURCE_PRECISION, BuildingType } from "@bibliothecadao/types";
import preset from "../../../../contracts/l3/world-native/tests/fixtures/current-presets/preset-3.json";
import type { PageGameContext } from "../utils/page-game-context";
import { readPageFacts } from "../utils/page-game-context";

/** A read-through page store; changing a row models Herald applying a confirmed fact. */
export function orderFixture() {
  const rows = {
    GameRegistry: [{ game_id: 39, preset_id: 2 }],
    SliceRules: [{ game_id: 39, ...structuredClone(preset.rules) }],
    UpgradeLimits: [{ game_id: 39, realm_max: 3 }],
    UpgradeRecipe: [1, 2, 3].map((level) => ({
      game_id: 39,
      level,
      costs: [{ resource_type: 3, amount: 1_000_000_000_000_000_000_000n }],
    })),
    BuildingRule: preset.buildings.map(({ category, rule }) => ({ game_id: 39, category, ...rule })),
    ResourceRule: preset.resources.map((rule) => ({ game_id: 39, ...rule })),
    Structure: [
      {
        game_id: 39,
        entity_id: 10,
        owner: 1n,
        resources_packed: 0x020304n,
        base: { category: 1, level: 1, troop_max_explorer_count: 3, starting_troops_granted: true },
        metadata: { realm_id: 123 },
      },
    ],
    StructureBuildings: [{ game_id: 39, entity_id: 10, population: { current: 0, max: 100 } }],
    ResourceWeight: [{ game_id: 39, entity_id: 10, capacity: 999_999_999n, weight: 0n }],
    ResourceBalance: preset.resources.map(({ resource_type }) => ({
      game_id: 39,
      entity_id: 10,
      resource_type,
      balance: BigInt(1_000_000 * RESOURCE_PRECISION),
    })),
    ResourceProduction: [] as {
      game_id: number;
      entity_id: number;
      resource_type: number;
      building_count: number;
      production_rate: bigint;
      output_amount_left: bigint;
      last_settled_at: number;
    }[],
    TileOccupancy: [{ game_id: 39, entity_id: 10, alt: false, col: 100, row: 100 }],
    TileOpt: [
      { game_id: 39, alt: false, col: 100, row: 100, data: 4n << 41n },
      { game_id: 39, alt: false, col: 101, row: 100, data: 4n << 41n },
    ],
    Building: [] as { game_id: number; structure_id: number; category: number; inner_col: number; inner_row: number }[],
    ExplorerTroops: [] as {
      game_id: number;
      explorer_id: number;
      owner: number;
      troops: {
        category: string;
        tier: string;
        count: bigint;
        stamina: { Inline: { amount: bigint; settled_at: number; remainder: number } };
        boosts: Record<string, number>;
      };
    }[],
  };
  const modelRows = rows as unknown as Record<string, Record<string, unknown>[]>;
  const get = (model: string, keys: Record<string, unknown>) =>
    modelRows[model]?.find((row) => Object.entries(keys).every(([key, value]) => String(row[key]) === String(value)));
  const store = {
    inGame: (model: string, gameId: number) => (modelRows[model] ?? []).filter((row) => row.game_id === gameId),
    get,
    require: (model: string, keys: Record<string, unknown>) => {
      const row = get(model, keys);
      if (!row) throw new Error(`${model} is not synchronized`);
      return row;
    },
    requireOrAbsent: (model: string, keys: Record<string, unknown>) => ({
      known:
        get(model, keys) ??
        (model === "ResourceBalance"
          ? { ...keys, balance: 0n }
          : { ...keys, building_count: 0, production_rate: 0n, output_amount_left: 0n, last_settled_at: 0 }),
    }),
    subscriptionScope: () => ({ known: true }),
  };
  const account = { address: "0x1", execute: vi.fn() };
  const context: PageGameContext = {
    store,
    network: {
      provider: { gameId: 39, contracts: { world: "0x123" }, provider: { channel: { nodeUrl: "https://rpc" } } },
    },
    account: { account },
    systemCalls: {},
  };
  const realm = () => ({
    id: 10,
    realmId: 123,
    level: rows.Structure[0].base.level,
    troopBalances: [],
    buildings: readPageFacts(context, "Building").map((row) => ({
      category: row.category,
      innerCol: row.inner_col,
      innerRow: row.inner_row,
    })),
  });
  function build(category: number, col = 11, row = 10) {
    rows.Building.push({ game_id: 39, structure_id: 10, category, inner_col: col, inner_row: row });
  }
  function army(category = "Crossbowman", tier = "T1", count = 50_000_000_000n) {
    rows.ExplorerTroops.push({
      game_id: 39,
      explorer_id: 20 + rows.ExplorerTroops.length,
      owner: 10,
      troops: { category, tier, count, stamina: { Inline: { amount: 20n, settled_at: 0, remainder: 0 } }, boosts: {} },
    });
  }
  function balance(resource: number, amount: number) {
    rows.ResourceBalance.find((row) => row.resource_type === resource).balance = BigInt(amount * RESOURCE_PRECISION);
  }
  return { rows, context, account, realm, build, army, balance };
}

export const farm = BuildingType.ResourceWheat;
