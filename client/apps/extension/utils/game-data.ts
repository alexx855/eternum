import { resources, resourceName, getLayerNeighborHexes } from "@bibliothecadao/types";

export interface ResourceCost {
  resource: number;
  amount: number;
}

export interface BuildingCostConfig {
  category: number;
  complexCosts: ResourceCost[];
  simpleCosts: ResourceCost[];
  populationCost: number;
  capacityGrant: number;
}

export interface BuildingCall {
  entity_id: number;
  directions: number[];
  building_type: number;
  use_simple: boolean;
  innerCol: number;
  innerRow: number;
}

export interface OccupiedBuildingSlot {
  innerCol: number;
  innerRow: number;
  category: number;
}

export interface StructureBuildingPopulation {
  current: number;
  max: number;
}

export interface StaminaConfig {
  staminaGainPerTick: number;
  armiesTickInSeconds: number;
  mapCenter: number;
  exploreStaminaCost: number;
  travelStaminaCost: number;
  staminaBonusValue: number;
  maxStamina: {
    knight: number;
    paladin: number;
    crossbowman: number;
  };
}

const normalizeTroopCategory = (troopCategory: string) => {
  const normalized = troopCategory.toLowerCase();
  if (normalized === "0" || normalized === "knight") return "knight";
  if (normalized === "1" || normalized === "paladin") return "paladin";
  if (normalized === "2" || normalized === "crossbowman") return "crossbowman";
  return normalized;
};

const isOpenTravelBiome = (biome: number) => [5, 6, 8, 9, 11, 14].includes(biome);

const isForestTravelBiome = (biome: number) => [10, 12, 13, 15, 16].includes(biome);

// Mirrors contracts/game/src/models/troop.cairo stamina_travel_bonus.
function getTravelStaminaModifier(biome: number, troopCategory: string) {
  if (biome === 1 || biome === 2) return -1;
  if (biome === 4) return 1;

  if (normalizeTroopCategory(troopCategory) !== "paladin") return 0;
  if (isOpenTravelBiome(biome)) return -1;
  if (isForestTravelBiome(biome)) return 1;
  return 0;
}

export function calculateMoveStaminaCost({
  biome,
  explore,
  staminaConfig,
  troopCategory,
}: {
  biome: number;
  explore: boolean;
  staminaConfig: StaminaConfig;
  troopCategory: string;
}) {
  if (explore) return staminaConfig.exploreStaminaCost;

  const modifier = getTravelStaminaModifier(biome, troopCategory);
  return staminaConfig.travelStaminaCost + modifier * staminaConfig.staminaBonusValue;
}

export function getNeighborCoords(
  x: number,
  y: number,
  alt = false,
): Array<{ x: number; y: number; direction: number }> {
  return getLayerNeighborHexes(x, y, alt).map(({ col, row, direction }) => ({ x: col, y: row, direction }));
}

// Extract biome from packed tile data (bit 41-48)
export function extractTileBiome(data: bigint): number {
  return Number((data >> 41n) & 0xffn);
}

// The deployed component adapter follows the shared resource catalog, including every troop tier.
export const RESOURCE_COLUMN_MAP: Partial<Record<number, string>> = Object.fromEntries(
  resources.map(({ id }) => [id, `${resourceName(id).toUpperCase().replace(/\s+/g, "_")}_BALANCE`]),
);

export const BASE_MAP_CENTER = 2147483646;

export interface ProductionData {
  building_count: number;
  production_rate: bigint;
  output_amount_left: bigint;
  last_updated_at: number;
}

export function calculateBalanceWithProduction(
  rawBalance: bigint,
  production: ProductionData | null,
  currentTick: number,
  isFood: boolean,
  remainingStorageCapacity: bigint,
  resourceWeightGram: bigint,
): bigint {
  if (!production || production.building_count === 0 || production.production_rate === 0n) {
    return rawBalance;
  }

  const ticksSinceUpdate = currentTick - production.last_updated_at;
  if (ticksSinceUpdate <= 0) return rawBalance;

  let amountProduced = BigInt(ticksSinceUpdate) * production.production_rate;

  if (!isFood && amountProduced > production.output_amount_left) {
    amountProduced = production.output_amount_left;
  }

  return rawBalance + limitProductionByStorageCapacity(amountProduced, remainingStorageCapacity, resourceWeightGram);
}

function limitProductionByStorageCapacity(
  amountProduced: bigint,
  remainingStorageCapacity: bigint,
  resourceWeightGram: bigint,
) {
  if (amountProduced <= 0n) return 0n;
  if (resourceWeightGram === 0n) return amountProduced;
  if (remainingStorageCapacity <= 0n) return 0n;

  const capacityLimitedAmount = remainingStorageCapacity / resourceWeightGram;

  return amountProduced > capacityLimitedAmount ? capacityLimitedAmount : amountProduced;
}

export const DEFAULT_ARMY_UNITS = 50;
