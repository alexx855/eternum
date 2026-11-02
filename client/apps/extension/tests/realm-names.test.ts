import { expect, it } from "vitest";
import canonicalRealms from "../../../../packages/core/src/data/canonical-realms.json";
import { getRealmName } from "../data/realm-names";

it("reads every realm name from the shared catalog", () => {
  canonicalRealms.realms.forEach(([name], index) => expect(getRealmName(index + 1)).toBe(name));
  for (const id of [0, -1, 1.5, NaN, canonicalRealms.realms.length + 1]) expect(getRealmName(id)).toBeNull();
});
