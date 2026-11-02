import { RESOURCE_PRECISION, TROOP_TYPES, TroopTier, resourceName } from "@bibliothecadao/types";
import { nativeFactModels } from "../../../../contracts/l3/world-native/schema/client.gen";
import { getTroopResourceId } from "../../../../packages/core/src/utils/army";

export const T1_TROOPS = TROOP_TYPES.map((type) => {
  const resourceId = getTroopResourceId(type, TroopTier.T1);
  return {
    resourceId,
    category: nativeFactModels.ExplorerTroops.fields.troops.category.enum.indexOf(type),
    name: resourceName(resourceId),
  };
});

export interface RealmTroopBalance {
  resourceId: number;
  balance: string;
}

export function selectArmyTroop(balances: RealmTroopBalance[], count: number) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const amount = BigInt(count) * BigInt(RESOURCE_PRECISION);
  return (
    T1_TROOPS.find((troop) =>
      balances.some((balance) => balance.resourceId === troop.resourceId && BigInt(balance.balance) >= amount),
    ) ?? null
  );
}
