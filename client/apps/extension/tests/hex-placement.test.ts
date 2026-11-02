import { describe, expect, it } from "vitest";
import { BUILDINGS_CENTER, getNeighborHexes, getLayerNeighborHexes } from "@bibliothecadao/types";
import { buildablePlotCount } from "../../../../packages/core/src/utils/castle-reach";
import { getNeighborCoords } from "../utils/game-data";
import { resolveFreeBuildingSlots } from "../utils/building-placement";

describe("shared hex geometry", () => {
  it.each([false, true])("uses native layer neighbors at altitude %s", (alt) => {
    expect(getNeighborCoords(100, 100, alt)).toEqual(
      getLayerNeighborHexes(100, 100, alt).map(({ col, row, direction }) => ({ x: col, y: row, direction })),
    );
  });
  it.each([0, 1, 2, 3])("offers every buildable plot at realm level %s with valid paths", (level) => {
    const slots = resolveFreeBuildingSlots({ level }, []);
    expect(slots).toHaveLength(buildablePlotCount(level));
    expect(new Set(slots.map((slot) => `${slot.innerCol},${slot.innerRow}`)).size).toBe(slots.length);
    for (const slot of slots) {
      const reached = slot.directions.reduce(
        (position, direction) => {
          return getNeighborHexes(position.col, position.row).find((next) => next.direction === direction)!;
        },
        { col: BUILDINGS_CENTER[0], row: BUILDINGS_CENTER[1] },
      );
      expect(reached).toMatchObject({ col: slot.innerCol, row: slot.innerRow });
    }
    const occupied = slots.map((slot) => ({ ...slot, category: 1 }));
    expect(resolveFreeBuildingSlots({ level }, occupied)).toEqual([]);
  });
});
