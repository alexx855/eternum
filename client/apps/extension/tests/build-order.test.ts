import { describe, expect, it } from "vitest";
import { BuildingType, ResourcesIds, TroopType, TROOP_TIERS, TROOP_TYPES } from "@bibliothecadao/types";
import {
  BUILD_ORDER_GOALS,
  buildOrderJson,
  DEFAULT_BUILD_ORDER,
} from "../../../../packages/core/src/automation/build-order";
import { parseBuildOrder } from "../utils/build-order";
import { readPageBuildOrder, buildOrderArmyProps } from "../utils/page-build-order";
import { farm, orderFixture } from "./build-order-fixture";

const order = (...steps: object[]) => JSON.stringify({ name: "Test", steps });
const step = (goal: string, count = 1, rank = "Settlement") => ({ rank, goal, count });

describe("official build orders on native facts", () => {
  it("accepts the official default and uses absolute targets across ranks", () => {
    const fixture = orderFixture();
    const json = buildOrderJson(DEFAULT_BUILD_ORDER);
    expect(parseBuildOrder(json)).toEqual(DEFAULT_BUILD_ORDER);
    expect(parseBuildOrder(json).steps).toHaveLength(26);
    for (let i = 0; i < 2; i++) fixture.build(farm, 11 + i);
    const preview = readPageBuildOrder(fixture.context, fixture.realm(), json);
    expect(preview.steps.filter((row) => row.label === preview.steps[0].label).map((row) => row.target)).toEqual([
      2, 4, 8, 12,
    ]);
    expect(preview.steps[0].status).toBe("complete");
    expect(preview.steps[10]).toMatchObject({ current: 2, target: 8, status: "locked" });
    expect(preview.steps[1]).toMatchObject({ current: 2, target: 4, status: "pending" });
    expect(preview.next?.buildingTypeHint).toBe(farm);
  });
  it.each(BUILD_ORDER_GOALS)("reads and resolves the official goal %s", (goal) => {
    const f = orderFixture();
    const preview = readPageBuildOrder(f.context, f.realm(), order(step(goal)));
    expect(preview.steps).toHaveLength(1);
    expect(preview.next || preview.blocker || preview.steps[0].status === "complete").toBeTruthy();
  });
  it("follows explicit upgrades in position and otherwise upgrades before building", () => {
    const f = orderFixture();
    f.rows.UpgradeRecipe.forEach((recipe) => {
      recipe.costs = [{ resource_type: 3, amount: 1n }];
    });
    expect(readPageBuildOrder(f.context, f.realm(), order(step("farm"))).next?.action).toBe("upgrade");
    const json = order(step("farm"), step("levelUp", 1, "City"));
    expect(readPageBuildOrder(f.context, f.realm(), json).next?.buildingTypeHint).toBe(farm);
    f.build(farm);
    expect(readPageBuildOrder(f.context, f.realm(), json).next?.action).toBe("upgrade");
  });
  it("offers a hut only when the next building needs population", () => {
    const f = orderFixture();
    f.rows.StructureBuildings[0].population = { current: 6, max: 0 };
    f.rows.SliceRules[0].building_config.base_population = 6;
    const rule = f.rows.BuildingRule.find((rule) => rule.category === farm);
    rule.population_cost = 3;
    expect(readPageBuildOrder(f.context, f.realm(), order(step("farm"))).next?.buildingTypeHint).toBe(
      BuildingType.WorkersHut,
    );
  });
  it.each(TROOP_TIERS)("chooses biome barracks and full armies at %s", (tier) => {
    const f = orderFixture();
    const suffix = tier === "T1" ? "" : tier;
    const preview = readPageBuildOrder(f.context, f.realm(), order(step(`army${suffix}`)));
    expect(preview.next).toMatchObject({ action: "deploy-army", troops: { type: TroopType.Crossbowman, tier } });
    expect(preview.next!.troops!.count).toBeGreaterThan(0);
    const barracks = readPageBuildOrder(f.context, f.realm(), order(step(`barracks${suffix}`)));
    expect(barracks.next!.buildingTypeHint).toBe(preview.next!.buildingTypeHint);
  });
  it("continues construction while an army is deferred without marking it complete", () => {
    const f = orderFixture();
    f.balance(ResourcesIds.Crossbowman, 0);
    f.build(BuildingType.ResourceCrossbowmanT1);
    const preview = readPageBuildOrder(f.context, f.realm(), order(step("army"), step("farm")));
    expect(preview.next?.buildingTypeHint).toBe(farm);
    expect(preview.steps[0]).toMatchObject({ status: "pending", current: 0 });
    f.rows.Structure[0].base.troop_max_explorer_count = 0;
    expect(readPageBuildOrder(f.context, f.realm(), order(step("army"), step("farm"))).next?.buildingTypeHint).toBe(
      farm,
    );
  });
  it("distinguishes neutral biomes, unknown terrain, future ranks, deposits and resource blockers", () => {
    const f = orderFixture();
    const json = order(step("barracks"), step("farm", 4, "Empire"));
    f.rows.SliceRules[0].troop_damage_config.damage_biome_bonus_num = 0;
    const preview = readPageBuildOrder(f.context, f.realm(), json);
    expect(preview.steps.map((row) => row.status)).toEqual(["skipped", "locked"]);
    expect(preview.blocker).toContain("Empire");
    f.balance(ResourcesIds.Wood, 0);
    f.balance(ResourcesIds.Labor, 0);
    expect(readPageBuildOrder(f.context, f.realm(), order(step("farm"))).blocker).toContain("resources");
    f.rows.Structure[0].resources_packed = 0n;
    expect(readPageBuildOrder(f.context, f.realm(), order(step("wood"))).blocker).toContain("deposit");
    f.rows.TileOpt = [];
    expect(() => readPageBuildOrder(f.context, f.realm(), json)).toThrow("biome");
  });
  it("blocks unsupported clients, non-Blitz games and unavailable native rules", () => {
    const f = orderFixture();
    f.rows.GameRegistry[0].preset_id = 3;
    expect(() => readPageBuildOrder(f.context, f.realm(), order(step("farm")))).toThrow("Blitz");
    const realm = f.realm();
    f.context.store = undefined;
    expect(() => readPageBuildOrder(f.context, realm, order(step("farm")))).toThrow("native game client");
  });
  it("reads category numbers from the ABI rather than troop display order", () => {
    expect(TROOP_TYPES).toEqual(["Knight", "Crossbowman", "Paladin"]);
    for (const [type, category] of [
      [TroopType.Knight, 0],
      [TroopType.Paladin, 1],
      [TroopType.Crossbowman, 2],
    ] as const)
      expect(buildOrderArmyProps(10, { type, tier: "T3", count: 50 }, 0)).toMatchObject({
        category,
        tier: 2,
        slot: 0,
        amount: 50_000_000_000n,
      });
  });
});
