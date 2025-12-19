/**
 * Torii API utilities for fetching player data
 * Uses shared packages from @bibliothecadao/* for type consistency
 */

import { SqlApi, type PlayerStructure } from "@bibliothecadao/torii";
import { BuildingType, Direction } from "@bibliothecadao/types";

// Re-export types and enums for convenience
export { BuildingType, Direction };
export type { PlayerStructure };

/**
 * Fetch player structures from the torii SQL endpoint
 */
export async function fetchPlayerStructures(
  toriiBaseUrl: string,
  ownerAddress: string
): Promise<PlayerStructure[]> {
  const sqlApi = new SqlApi(`${toriiBaseUrl}/sql`);
  return sqlApi.fetchPlayerStructures(ownerAddress);
}

/**
 * Filter structures to only include realms (category = 1)
 */
export function filterRealms(structures: PlayerStructure[]): PlayerStructure[] {
  return structures.filter((s) => s.category === 1);
}

/**
 * Building call data sent to main-world for execution
 */
export interface BuildingCall {
  entity_id: number;
  directions: number[];
  building_type: number;
}

/**
 * Generate calls for Food & Labor (Farms + Workers Hut)
 * - Farm 1: EAST (0)
 * - Farm 2: NORTH_EAST (1)
 * - Workers Hut: NORTH_WEST (2)
 */
export function generateFoodAndLaborCalls(realms: PlayerStructure[]): BuildingCall[] {
  const calls: BuildingCall[] = [];

  for (const realm of realms) {
    // Farm 1: Direction EAST (0)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.EAST],
      building_type: BuildingType.ResourceWheat,
    });

    // Farm 2: Direction NORTH_EAST (1)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.NORTH_EAST],
      building_type: BuildingType.ResourceWheat,
    });

    // Workers Hut: Direction NORTH_WEST (2)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.NORTH_WEST],
      building_type: BuildingType.WorkersHut,
    });
  }

  return calls;
}

/**
 * Generate calls for Resource Mines (Wood, Coal, Copper)
 * - Wood: WEST (3)
 * - Coal: SOUTH_WEST (4)
 * - Copper: SOUTH_EAST (5)
 */
export function generateResourceMinesCalls(realms: PlayerStructure[]): BuildingCall[] {
  const calls: BuildingCall[] = [];

  for (const realm of realms) {
    // Wood: WEST (3)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.WEST],
      building_type: BuildingType.ResourceWood,
    });

    // Coal: SOUTH_WEST (4)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.SOUTH_WEST],
      building_type: BuildingType.ResourceCoal,
    });

    // Copper: SOUTH_EAST (5)
    calls.push({
      entity_id: realm.entity_id,
      directions: [Direction.SOUTH_EAST],
      building_type: BuildingType.ResourceCopper,
    });
  }

  return calls;
}
