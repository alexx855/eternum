import type { BuildingCostConfig, ResourceCost } from "./game-data";
import { buildingName } from "@bibliothecadao/types";

export function selectBuildingCosts(
  type: number,
  buildingCosts: Map<number, BuildingCostConfig>,
  useSimpleCost: boolean,
): ResourceCost[] {
  const config = buildingCosts.get(type);
  if (!config) {
    throw new Error(`Missing building cost config for ${buildingName(type, false)}`);
  }

  const costs = useSimpleCost ? config.simpleCosts : config.complexCosts;
  if (costs.length === 0) {
    const mode = useSimpleCost ? "simple" : "complex";
    throw new Error(`No ${mode} cost configured for ${buildingName(type, false)}`);
  }

  return costs;
}
