import { BUILDINGS_CENTER, getNeighborHexes } from "@bibliothecadao/types";
import { buildableRadius } from "../../../../packages/core/src/utils/castle-reach";
import type { OccupiedBuildingSlot } from "./game-data";

interface BuildingSlot {
  directions: number[];
  innerCol: number;
  innerRow: number;
}

export function resolveFreeBuildingSlots(realm: { level: number }, occupiedBuildings: readonly OccupiedBuildingSlot[]) {
  const occupied = new Set(occupiedBuildings.map((building) => slotKey(building.innerCol, building.innerRow)));
  return generateCandidateSlots(buildableRadius(realm.level)).filter(
    (slot) => !occupied.has(slotKey(slot.innerCol, slot.innerRow)),
  );
}

function generateCandidateSlots(radius: number) {
  const center = { directions: [], innerCol: BUILDINGS_CENTER[0], innerRow: BUILDINGS_CENTER[1] };
  const queue: BuildingSlot[] = [center];
  const visited = new Set([slotKey(center.innerCol, center.innerRow)]);
  const slots: BuildingSlot[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.directions.length >= radius) continue;
    for (const neighbor of getNeighborHexes(current.innerCol, current.innerRow)) {
      const key = slotKey(neighbor.col, neighbor.row);
      if (visited.has(key)) continue;
      const next = {
        directions: [...current.directions, neighbor.direction],
        innerCol: neighbor.col,
        innerRow: neighbor.row,
      };
      visited.add(key);
      queue.push(next);
      slots.push(next);
    }
  }
  return slots;
}

function slotKey(col: number, row: number) {
  return `${col},${row}`;
}
