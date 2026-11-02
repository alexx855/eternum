import { describe, expect, it } from "vitest";
import { TROOP_TYPES, TroopTier, RESOURCE_PRECISION } from "@bibliothecadao/types";
import { nativeFactModels } from "../../../../contracts/l3/world-native/schema/client.gen";
import { getTroopResourceId } from "../../../../packages/core/src/utils/army";
import { T1_TROOPS, selectArmyTroop } from "../utils/army-troops";

describe("quick army troop catalog", () => {
  it("covers every troop type with its native ABI index and T1 resource", () => {
    expect(T1_TROOPS).toHaveLength(TROOP_TYPES.length);
    for (const type of TROOP_TYPES) {
      const resourceId = getTroopResourceId(type, TroopTier.T1);
      expect(selectArmyTroop([{ resourceId, balance: String(50n * BigInt(RESOURCE_PRECISION)) }], 50)).toMatchObject({
        resourceId,
        category: nativeFactModels.ExplorerTroops.fields.troops.category.enum.indexOf(type),
      });
    }
  });
  it("rejects insufficient or fractional troop amounts", () => {
    expect(selectArmyTroop([{ resourceId: T1_TROOPS[0].resourceId, balance: "1" }], 50)).toBeNull();
    expect(selectArmyTroop([], 1.5)).toBeNull();
  });
});
