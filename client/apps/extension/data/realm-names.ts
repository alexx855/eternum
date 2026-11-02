import { getRealmNameById } from "../../../../packages/core/src/utils/realm";

export function getRealmName(realmId: number): string | null {
  return getRealmNameById(realmId) || null;
}
