// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateBuildingCallCosts } from "../utils/building-costs";
import type { BuildingCall, BuildingCostConfig } from "../utils/game-data";
import { BuildingType, buildingName } from "@bibliothecadao/types";

describe("calculateBuildingCallCosts", () => {
  it("scales costs for the exact submitted calls from the current building counts", () => {
    const costs = calculateBuildingCallCosts(
      [
        createBuildingCall({ building_type: 31, use_simple: false }),
        createBuildingCall({ building_type: 34, use_simple: true }),
        createBuildingCall({ building_type: 31, use_simple: false }),
      ],
      new Map([[31, 2]]),
      createBuildingCosts(),
      1000,
    );

    expect(costs).toEqual([
      { resource: 91, amount: 33 },
      { resource: 92, amount: 5 },
    ]);
  });
});

describe("T2/T3 military buildings without simple cost", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when calculating call costs for Knight T2 Barracks in simple mode", () => {
    const buildingCosts = createMilitaryBuildingCosts(BuildingType.ResourceKnightT2);

    expect(() =>
      calculateBuildingCallCosts(
        [createBuildingCall({ building_type: BuildingType.ResourceKnightT2, use_simple: true })],
        new Map(),
        buildingCosts,
        1000,
      ),
    ).toThrow(`No simple cost configured for ${buildingName(BuildingType.ResourceKnightT2, false)}`);
  });
});

function createBuildingCall(overrides: Pick<BuildingCall, "building_type" | "use_simple">): BuildingCall {
  return {
    entity_id: 1,
    directions: [1],
    innerCol: 1,
    innerRow: 1,
    ...overrides,
  };
}

function createBuildingCosts() {
  return new Map<number, BuildingCostConfig>([
    [
      31,
      {
        category: 31,
        complexCosts: [{ resource: 91, amount: 10 }],
        simpleCosts: [{ resource: 93, amount: 20 }],
        populationCost: 0,
        capacityGrant: 0,
      },
    ],
    [
      34,
      {
        category: 34,
        complexCosts: [{ resource: 94, amount: 30 }],
        simpleCosts: [{ resource: 92, amount: 5 }],
        populationCost: 0,
        capacityGrant: 0,
      },
    ],
  ]);
}

function createMilitaryBuildingCosts(buildingType: number): Map<number, BuildingCostConfig> {
  return new Map([
    [
      buildingType,
      {
        category: buildingType,
        complexCosts: [{ resource: 19, amount: 100 }],
        simpleCosts: [],
        populationCost: 0,
        capacityGrant: 0,
      },
    ],
  ]);
}
