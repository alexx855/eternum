import { describe, expect, it } from "vitest";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import { calculateBalanceWithProduction, type ProductionData } from "../utils/game-data";

const units = (amount: number) => BigInt(amount * RESOURCE_PRECISION);
const production: ProductionData = {
  building_count: 1,
  production_rate: units(5),
  output_amount_left: units(100),
  last_updated_at: 100,
};

describe("native resource presentation", () => {
  it("caps projected materials by remaining output and weighted storage", () => {
    expect(calculateBalanceWithProduction(units(10), production, 105, false, units(2) * 1000n, 1000n)).toBe(units(12));
    expect(
      calculateBalanceWithProduction(
        units(10),
        { ...production, output_amount_left: units(1) },
        105,
        false,
        units(100) * 1000n,
        1000n,
      ),
    ).toBe(units(11));
    expect(calculateBalanceWithProduction(units(10), production, 105, false, units(10) * 1000n, 2000n)).toBe(units(15));
  });
  it("projects food past its output cap while honoring storage", () => {
    expect(
      calculateBalanceWithProduction(
        0n,
        { ...production, output_amount_left: units(1) },
        105,
        true,
        units(3) * 1000n,
        1000n,
      ),
    ).toBe(units(3));
  });
  it("does not consume weighted storage for a zero-weight resource", () => {
    expect(calculateBalanceWithProduction(0n, production, 105, true, 0n, 0n)).toBe(units(25));
  });
  it("keeps balances unchanged when no time, storage, or production is available", () => {
    expect(calculateBalanceWithProduction(units(10), production, 100, false, units(100), 1000n)).toBe(units(10));
    expect(calculateBalanceWithProduction(units(10), production, 105, false, 0n, 1000n)).toBe(units(10));
    expect(calculateBalanceWithProduction(units(10), null, 105, false, units(100), 1000n)).toBe(units(10));
  });
});
