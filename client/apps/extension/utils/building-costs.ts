import type { BuildingCall, BuildingCostConfig, ResourceCost, StructureBuildingPopulation } from "./game-data";
import { buildingName, resourceName } from "@bibliothecadao/types";
import { selectBuildingCosts } from "./building-cost-mode";

const COST_PERCENT_PRECISION = 10_000;
const POPULATION_REQUIREMENT_RESOURCE_ID = -1;

function getBuildingName(type: number) {
  return buildingName(type, false);
}

function resolveBuildingCostConfig(type: number, buildingCosts: Map<number, BuildingCostConfig>) {
  const config = buildingCosts.get(type);
  if (!config) {
    throw new Error(`Missing building cost config for ${getBuildingName(type)}`);
  }

  return config;
}

function scaleBuildingCostAmount(amount: number, buildingCount: number, baseCostPercentIncrease: number) {
  const scaleFactor = buildingCount - 1;
  const additionalCost = (amount * baseCostPercentIncrease) / COST_PERCENT_PRECISION;
  return amount + scaleFactor * scaleFactor * additionalCost;
}

function addResourceCosts(totalCostsMap: Map<number, number>, costs: ResourceCost[]) {
  for (const cost of costs) {
    totalCostsMap.set(cost.resource, (totalCostsMap.get(cost.resource) ?? 0) + cost.amount);
  }
}

export function calculateBuildingCallCosts(
  buildingCalls: readonly Pick<BuildingCall, "building_type" | "use_simple">[],
  currentCounts: Map<number, number>,
  buildingCosts: Map<number, BuildingCostConfig>,
  baseCostPercentIncrease: number,
): ResourceCost[] {
  const runningCounts = new Map(currentCounts);
  const totalCostsMap = new Map<number, number>();

  for (const calls of groupBuildingCallsByType(buildingCalls)) {
    for (const call of calls) {
      const type = call.building_type;
      const nextCount = (runningCounts.get(type) ?? 0) + 1;
      const costs = selectBuildingCosts(type, buildingCosts, call.use_simple);
      const scaledCosts = costs.map((cost) => ({
        resource: cost.resource,
        amount: scaleBuildingCostAmount(cost.amount, nextCount, baseCostPercentIncrease),
      }));

      runningCounts.set(type, nextCount);
      addResourceCosts(totalCostsMap, scaledCosts);
    }
  }

  return Array.from(totalCostsMap.entries()).map(([resource, amount]) => ({ resource, amount }));
}

function groupBuildingCallsByType(buildingCalls: readonly Pick<BuildingCall, "building_type" | "use_simple">[]) {
  const callsByType = new Map<number, Pick<BuildingCall, "building_type" | "use_simple">[]>();

  for (const call of buildingCalls) {
    const calls = callsByType.get(call.building_type) ?? [];
    if (!callsByType.has(call.building_type)) {
      callsByType.set(call.building_type, calls);
    }

    calls.push(call);
  }

  return Array.from(callsByType.values());
}

export interface ResourceSufficiencyDetail {
  resource: number;
  name: string;
  required: number;
  available: number;
  progress: number;
  sufficient: boolean;
  context?: {
    kind: "population";
    liveCurrent: number;
    liveCapacity: number;
    projectedCurrent: number;
    projectedCapacity: number;
  };
}

export interface ResourceSufficiency {
  sufficient: boolean;
  progress: number;
  details: ResourceSufficiencyDetail[];
}

function createSufficiency(details: ResourceSufficiencyDetail[]): ResourceSufficiency {
  if (details.length === 0) {
    return { sufficient: true, progress: 100, details: [] };
  }

  return {
    sufficient: details.every((detail) => detail.sufficient),
    progress: Math.min(...details.map((detail) => detail.progress)),
    details,
  };
}

export function checkResourceSufficiency(
  required: ResourceCost[],
  available: Map<number, number>,
): ResourceSufficiency {
  if (required.length === 0) {
    return createSufficiency([]);
  }

  const details = required.map((cost) => {
    const availableAmount = available.get(cost.resource) ?? 0;
    const progress = cost.amount > 0 ? Math.min(100, (availableAmount / cost.amount) * 100) : 100;
    return {
      resource: cost.resource,
      name: resourceName(cost.resource),
      required: cost.amount,
      available: availableAmount,
      progress,
      sufficient: availableAmount >= cost.amount,
    };
  });

  return createSufficiency(details);
}

export function checkPopulationSufficiency(
  buildingTypes: readonly number[],
  buildingCosts: Map<number, BuildingCostConfig>,
  basePopulation: number,
  population: StructureBuildingPopulation,
): ResourceSufficiencyDetail | null {
  if (buildingTypes.length === 0) return null;

  const liveCurrent = population.current;
  const liveCapacity = basePopulation + population.max;

  let projectedCurrent = liveCurrent;
  let projectedMax = population.max;

  for (const type of buildingTypes) {
    const config = resolveBuildingCostConfig(type, buildingCosts);
    projectedCurrent += config.populationCost;
    projectedMax += config.capacityGrant;
  }

  const projectedCapacity = basePopulation + projectedMax;
  const progress = projectedCurrent > 0 ? Math.min(100, (projectedCapacity / projectedCurrent) * 100) : 100;

  return {
    resource: POPULATION_REQUIREMENT_RESOURCE_ID,
    name: "Population Capacity",
    required: projectedCurrent,
    available: projectedCapacity,
    progress,
    sufficient: projectedCapacity >= projectedCurrent,
    context: {
      kind: "population",
      liveCurrent,
      liveCapacity,
      projectedCurrent,
      projectedCapacity,
    },
  };
}
