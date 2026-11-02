import { orderFixture } from "./build-order-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import { readPageBuildingConfig, readPageRealmBuildingState } from "../utils/page-building-state";
import { RESOURCE_COLUMN_MAP } from "../utils/game-data";
import type { PageGameContext } from "../utils/page-game-context";

function component(rows: Record<string, unknown>[]) {
  return {
    values: Object.fromEntries(
      [...new Set(rows.flatMap(Object.keys))].map((key) => [key, new Map(rows.map((row, index) => [index, row[key]]))]),
    ),
  };
}

function deployedContext(): PageGameContext {
  const balances = Object.fromEntries(Object.values(RESOURCE_COLUMN_MAP).map((column) => [column!, 0n]));
  return {
    network: {
      provider: { gameId: 39 },
      contractComponents: {
        GameRegistry: component([
          { game_id: 40, preset_id: 99 },
          { game_id: 39, preset_id: 7 },
        ]),
        PresetConfig: component([
          { preset_id: 99, building_config: { base_population: 999, base_cost_percent_increase: 999 } },
          { preset_id: 7, building_config: { base_population: 6, base_cost_percent_increase: 10000 } },
        ]),
        BuildingCategoryConfig: component([
          {
            preset_id: 7,
            category: 1,
            population_cost: 0,
            capacity_grant: 6,
            simple_erection_cost_id: 10,
            simple_erection_cost_count: 1,
            complex_erection_cost_id: 11,
            complex_erection_cost_count: 0,
          },
        ]),
        ResourceList: component([
          { preset_id: 99, entity_id: 10, index: 0, resource_type: 23, amount: BigInt(999 * RESOURCE_PRECISION) },
          { preset_id: 7, entity_id: 10, index: 0, resource_type: 23, amount: BigInt(10 * RESOURCE_PRECISION) },
        ]),
        Structure: component([{ game_id: 39, entity_id: 10, resources_packed: 0x020304n }]),
        StructureBuildings: component([{ game_id: 39, entity_id: 10, population: { current: 3, max: 6 } }]),
        Resource: component([
          {
            game_id: 39,
            entity_id: 10,
            ...balances,
            WOOD_BALANCE: BigInt(2 * RESOURCE_PRECISION),
            WOOD_PRODUCTION: {
              building_count: 1,
              production_rate: BigInt(RESOURCE_PRECISION),
              output_amount_left: BigInt(20 * RESOURCE_PRECISION),
              last_updated_at: 90,
            },
            weight: { capacity: BigInt(5 * RESOURCE_PRECISION * 1000), weight: BigInt(3 * RESOURCE_PRECISION * 1000) },
          },
        ]),
        WeightConfig: component(
          Object.keys(RESOURCE_COLUMN_MAP).map((id) => ({
            preset_id: 7,
            resource_type: Number(id),
            weight_gram: 1000n,
          })),
        ),
      },
    },
    account: { account: { address: "0x1" } },
    systemCalls: {},
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.spyOn(Date, "now").mockReturnValue(100_000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("synchronized building requirements", () => {
  it("uses the active game's preset and converts cost precision", () => {
    const config = readPageBuildingConfig(deployedContext());
    expect(config.basePopulation).toBe(6);
    expect(config.costs[0]).toEqual({
      category: 1,
      populationCost: 0,
      capacityGrant: 6,
      simpleCosts: [{ resource: 23, amount: 10 }],
      complexCosts: [],
    });
  });
  it("rejects incomplete declared cost lists", () => {
    const context = deployedContext();
    context.network.contractComponents!.ResourceList = component([
      { preset_id: 7, entity_id: 10, index: 1, resource_type: 23, amount: 0n },
    ]);
    expect(() => readPageBuildingConfig(context)).toThrow("not synchronized");
  });
  it("projects deployed production with the realm's storage limit", () => {
    const state = readPageRealmBuildingState(deployedContext(), 10)!;
    expect(state.resourcesPacked).toBe(String(0x020304));
    expect(state.population).toEqual({ current: 3, max: 6 });
    expect(new Map(state.balances).get(3)).toBe(4);
  });
  it.each([0n, (1n << 128n) - 1n])("does not cap native zero-weight production at storage capacity %s", (capacity) => {
    const { context, rows } = orderFixture();
    rows.ResourceWeight[0] = { game_id: 39, entity_id: 10, capacity, weight: capacity };
    rows.ResourceRule.find((rule) => rule.resource_type === 35).unit_weight = 0n;
    rows.ResourceBalance.find((balance) => balance.resource_type === 35).balance = 0n;
    rows.ResourceProduction.push({
      game_id: 39,
      entity_id: 10,
      resource_type: 35,
      building_count: 1,
      production_rate: BigInt(RESOURCE_PRECISION),
      output_amount_left: 0n,
      last_settled_at: 90,
    });
    rows.SliceRules[0].mode_rules = 0;
    expect(new Map(readPageRealmBuildingState(context, 10).balances).get(35)).toBe(10);
  });

  it("does not invent native balances while sparse facts are unknown", () => {
    const { context } = orderFixture();
    Object.assign(context.store!, { requireOrAbsent: () => ({ unknown: "INCOMPLETE_SNAPSHOT" }) });
    expect(() => readPageRealmBuildingState(context, 10)).toThrow("not synchronized");
  });

  it("reads native balances and production without falling back to components", () => {
    const context = deployedContext();
    const rows: Record<string, Record<string, unknown>[]> = {
      Structure: [{ entity_id: 10n, resources_packed: 3n }],
      StructureBuildings: [{ entity_id: 10n, population: { current: 2, max: 8 } }],
      ResourceBalance: [{ entity_id: 10n, resource_type: 3, balance: BigInt(2 * RESOURCE_PRECISION) }],
      ResourceProduction: [
        {
          entity_id: 10n,
          resource_type: 3,
          building_count: 1,
          production_rate: BigInt(RESOURCE_PRECISION),
          output_amount_left: BigInt(3 * RESOURCE_PRECISION),
          last_settled_at: 90,
        },
      ],
      ResourceWeight: [{ entity_id: 10n, capacity: BigInt(100 * RESOURCE_PRECISION * 1000), weight: 0n }],
      ResourceRule: [{ resource_type: 3, unit_weight: 1000n }],
    };
    for (const entries of Object.values(rows)) for (const row of entries) row.game_id = 39;
    rows.SliceRules = [{ ...orderFixture().rows.SliceRules[0], mode_rules: 0 }];
    const get = (model: string, keys: Record<string, unknown>) =>
      rows[model]?.find((row) => Object.entries(keys).every(([key, value]) => String(row[key]) === String(value)));
    context.store = {
      inGame: (model) => rows[model],
      get,
      require: (model: string, keys: Record<string, unknown>) => get(model, keys),
      requireOrAbsent: (model: string, keys: Record<string, unknown>) => ({
        known:
          get(model, keys) ??
          (model === "ResourceBalance" ? { balance: 0n } : { building_count: 0, production_rate: 0n }),
      }),
    } as PageGameContext["store"];
    expect(new Map(readPageRealmBuildingState(context, 10)!.balances).get(3)).toBe(5);
    rows.ResourceWeight = [];
    expect(() => readPageRealmBuildingState(context, 10)).toThrow("resources are not synchronized");
  });
});
