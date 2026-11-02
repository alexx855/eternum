import { ResourceManager } from "../../../../packages/core/src/managers/resource-manager";
import type { NativeFactStore } from "../../../../packages/core/src/client/native-fact-store";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import { resolveUseSimpleCost, buildingCostModeOf } from "../../../../packages/core/src/utils/building-cost-mode";
import type { LiveBuildingConfig, LiveRealm } from "./live-game";
import {
  readPagePresetRows as readPresetRows,
  readPageRules,
  readPageFacts,
  type PageGameContext,
} from "./page-game-context";
import { calculateBalanceWithProduction, RESOURCE_COLUMN_MAP, type ProductionData } from "./game-data";

interface PresetBuildingRule {
  category: number;
  population_cost: number;
  capacity_grant: number;
  simple_erection_cost_id: number;
  simple_erection_cost_count: number;
  complex_erection_cost_id: number;
  complex_erection_cost_count: number;
}
interface PresetResourceCost {
  entity_id: number;
  index: number;
  resource_type: number;
  amount: bigint;
}

export function readPageBuildingConfig(context: PageGameContext): LiveBuildingConfig {
  const rules = readPageRules(context);
  if (!rules?.building_config) throw new Error("Building rules are not synchronized.");
  const costs = context.store ? readNativeBuildingCosts(context) : readPresetBuildingCosts(context);
  if (!costs.length) throw new Error("Building costs are not synchronized.");
  return {
    costs,
    basePopulation: rules.building_config.base_population,
    baseCostPercentIncrease: rules.building_config.base_cost_percent_increase,
    useSimpleCost: resolveUseSimpleCost(
      buildingCostModeOf(costs.map((cost) => ({ simple_cost: cost.simpleCosts, complex_cost: cost.complexCosts }))),
      false,
    ),
  };
}

export function readPageRealmBuildingState(
  context: PageGameContext,
  realmId: number,
): NonNullable<LiveRealm["buildingState"]> {
  const structure = readPageFacts(context, "Structure").find((row) => row.entity_id === realmId);
  const buildings = readPageFacts(context, "StructureBuildings").find((row) => row.entity_id === realmId);
  if (!structure || structure.resources_packed === undefined || !buildings?.population)
    throw new Error("Realm requirements are not synchronized.");
  return {
    resourcesPacked: String(structure.resources_packed),
    population: buildings.population,
    balances: context.store ? readNativeBalances(context, realmId) : readComponentBalances(context, realmId),
  };
}

function readNativeBuildingCosts(context: PageGameContext) {
  return readPageFacts(context, "BuildingRule").map((rule) => ({
    category: rule.category,
    populationCost: rule.population_cost,
    capacityGrant: rule.capacity_grant,
    simpleCosts: rule.simple_cost.map(displayCost),
    complexCosts: rule.complex_cost.map(displayCost),
  }));
}

function readPresetBuildingCosts(context: PageGameContext) {
  const lists = readPresetRows<PresetResourceCost>(context, "ResourceList");
  function declaredCosts(id: number, count: number) {
    const costs = lists.filter((row) => row.entity_id === id && row.index < count).sort((a, b) => a.index - b.index);
    if (costs.length !== count || costs.some((row, index) => row.index !== index))
      throw new Error(`Building cost list ${id} is not synchronized.`);
    return costs.map(displayCost);
  }
  return readPresetRows<PresetBuildingRule>(context, "BuildingCategoryConfig").map((rule) => ({
    category: rule.category,
    populationCost: rule.population_cost,
    capacityGrant: rule.capacity_grant,
    simpleCosts: declaredCosts(rule.simple_erection_cost_id, rule.simple_erection_cost_count),
    complexCosts: declaredCosts(rule.complex_erection_cost_id, rule.complex_erection_cost_count),
  }));
}

function displayCost(row: { resource_type: number; amount: bigint }) {
  return { resource: row.resource_type, amount: Number(row.amount) / RESOURCE_PRECISION };
}

function readNativeBalances(context: PageGameContext, realmId: number): [number, number][] {
  const manager = new ResourceManager(context.store as NativeFactStore, realmId, context.network.provider.gameId);
  const balances = manager.balances(Math.floor(Date.now() / 1000));
  if (!balances) throw new Error("Realm resources are not synchronized.");
  return balances.map(({ resourceId, amount }) => [resourceId, amount / RESOURCE_PRECISION]);
}

function readComponentBalances(context: PageGameContext, realmId: number): [number, number][] {
  const resources = readPageFacts(context, "Resource").find((row) => row.entity_id === realmId);
  const weights = new Map(
    readPresetRows<{ resource_type: number; weight_gram: bigint }>(context, "WeightConfig").map((row) => [
      row.resource_type,
      row.weight_gram,
    ]),
  );
  if (!resources?.weight) throw new Error("Realm resources are not synchronized.");
  return Object.entries(RESOURCE_COLUMN_MAP).map(([id, column]) => {
    const resource = Number(id);
    const balance = resources[column!];
    const production = resources[column!.replace("_BALANCE", "_PRODUCTION")] as ProductionData | undefined;
    const weight = weights.get(resource);
    if (typeof balance !== "bigint" || weight === undefined) throw new Error(`Resource unavailable: ${resource}`);
    return [
      resource,
      Number(projectedBalance(balance, production ?? null, resource, resources.weight, weight)) / RESOURCE_PRECISION,
    ];
  });
}

function projectedBalance(
  balance: bigint,
  production: ProductionData | null,
  resource: number,
  storage: { capacity: bigint; weight: bigint },
  weight: bigint,
) {
  return calculateBalanceWithProduction(
    balance,
    production,
    Math.floor(Date.now() / 1000),
    resource === 23 || resource === 35 || resource === 36,
    storage.capacity > storage.weight ? storage.capacity - storage.weight : 0n,
    weight,
  );
}
