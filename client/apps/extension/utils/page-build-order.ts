import {
  BuildingType,
  getBuildingFromResource,
  getResourceTiers,
  RESOURCE_PRECISION,
  resourceName,
  StructureType,
  TROOP_TYPES,
  TroopTier,
  troopTierIndex,
} from "@bibliothecadao/types";
import { nativeFactModels } from "../../../../contracts/l3/world-native/schema/client.gen";
import { ClientConfigManager } from "../../../../packages/core/src/managers/config-manager";
import type { NativeFactStore } from "../../../../packages/core/src/client/native-fact-store";
import { blitzBuildingResource } from "../../../../packages/core/src/automation/build-order";
import type {
  BlitzRealmSuggestionInput,
  BlitzTroop,
  BlitzSuggestionDraft,
} from "../../../../packages/core/src/automation/blitz-suggestions";
import { getTroopResourceId } from "../../../../packages/core/src/utils/army";
import { nativeGameModeOf } from "../../../../packages/core/src/utils/native-preset-mode";
import { biomeTypeOf } from "../../../../packages/core/src/utils/tile";
import { unpackValue } from "../../../../packages/core/src/utils/packed-data";
import { resolveUseSimpleCost } from "../../../../packages/core/src/utils/building-cost-mode";
import { calculateBuildingCallCosts, checkPopulationSufficiency, checkResourceSufficiency } from "./building-costs";
import { parseBuildOrder, planBuildOrder } from "./build-order";
import { resolveFreeBuildingSlots } from "./building-placement";
import { readPageBuildingConfig, readPageRealmBuildingState } from "./page-building-state";
import { isPageTileOccupied, readPageEntityPosition, readPageFacts, type PageGameContext } from "./page-game-context";
import { extractTileBiome, getNeighborCoords } from "./game-data";
import type { LiveRealm, LiveBuildingConfig } from "./live-game";

/** The page's native store is read through; no rows are copied into a second store. */
function requireNativeStore(context: PageGameContext): NativeFactStore {
  const store = context.store as NativeFactStore | undefined;
  if (!store || typeof store.require !== "function" || typeof store.get !== "function")
    throw new Error("Build orders require the current native game client.");
  return store;
}

export function readPageBuildOrder(context: PageGameContext, realm: LiveRealm, json: string) {
  const order = parseBuildOrder(json);
  const store = requireNativeStore(context);
  const gameId = context.network.provider.gameId;
  const game = store.require("GameRegistry", { game_id: gameId });
  if (nativeGameModeOf(game.preset_id) !== "blitz") throw new Error("Build orders are available in Blitz games only.");
  const config = new ClientConfigManager();
  config.setActiveGame(gameId, game.preset_id);
  config.setStore(store);
  const input = readOrderInput(context, realm, config);
  const preview = planBuildOrder(order, input);
  preview.useSimpleCost = resolveUseSimpleCost(config.buildingCostMode, false);
  preview.spawnDirections = readSpawnDirections(context, realm.id);
  if (preview.next?.action === "deploy-army" && !preview.spawnDirections.length)
    preview.blocker = "No explored, unoccupied tile next to this realm. Clear a spawn tile to deploy.";
  return preview;
}

function readOrderInput(
  context: PageGameContext,
  realm: LiveRealm,
  config: ClientConfigManager,
): BlitzRealmSuggestionInput {
  const store = requireNativeStore(context);
  const gameId = context.network.provider.gameId;
  const structure = store.require("Structure", { game_id: gameId, entity_id: realm.id });
  if (structure.base.category !== StructureType.Realm) throw new Error("Build orders need a realm.");
  if (!structure.base.starting_troops_granted)
    throw new Error("Provision this realm in the game before following an order.");
  const state = readPageRealmBuildingState(context, realm.id);
  const buildingConfig = readPageBuildingConfig(context);
  const useSimpleCost = resolveUseSimpleCost(config.buildingCostMode, false);
  const costs = new Map(buildingConfig.costs.map((cost) => [cost.category, cost]));
  const counts = new Map<number, number>();
  for (const building of realm.buildings) counts.set(building.category, (counts.get(building.category) ?? 0) + 1);
  const balances = new Map(state.balances);
  const hasAvailableBuildingTile = resolveFreeBuildingSlots(realm, realm.buildings).length > 0;
  const maxLevel = config.getMaxLevel(StructureType.Realm);
  const upgrades = realm.level < maxLevel ? config.getRealmUpgradeCosts(realm.level + 1) : undefined;
  const armies = readPageFacts(context, "ExplorerTroops")
    .filter((army) => army.owner === realm.id && BigInt(army.troops.count) > 0n)
    .map((army) => ({ type: army.troops.category, tier: army.troops.tier }));
  return {
    realmId: realm.id,
    realmName: String(realm.realmId),
    realmLevel: realm.level,
    isBlitzActive: true,
    canAffordUpgrade: upgrades !== undefined && checkResourceSufficiency(upgrades, balances).sufficient,
    hasAvailableBuildingTile,
    built: (type) => counts.get(type) ?? 0,
    population: state.population.current,
    populationCapacity: state.population.max + buildingConfig.basePopulation,
    troop: readBiomeTroop(context, realm.id, config),
    army: {
      armies,
      maxArmies: structure.base.troop_max_explorer_count,
      troopsOnHand: (resource) => Math.floor(balances.get(resource) ?? 0),
      fullArmy: (tier) => config.getMaxArmySize(realm.level, tier),
    },
    buildability: (building) =>
      readBuildingReadiness(building, {
        costs,
        counts,
        balances,
        state,
        config: buildingConfig,
        useSimpleCost,
        hasAvailableBuildingTile,
      }),
  };
}

function readBuildingReadiness(
  building: BuildingType,
  input: {
    costs: Map<number, LiveBuildingConfig["costs"][number]>;
    counts: Map<number, number>;
    balances: Map<number, number>;
    state: NonNullable<LiveRealm["buildingState"]>;
    config: LiveBuildingConfig;
    useSimpleCost: boolean;
    hasAvailableBuildingTile: boolean;
  },
) {
  const { costs, counts, balances, state, config, useSimpleCost, hasAvailableBuildingTile } = input;
  const population = checkPopulationSufficiency([building], costs, config.basePopulation, state.population);
  const needsRoom = building !== BuildingType.WorkersHut && population?.sufficient === false;
  const required = calculateBuildingCallCosts(
    [{ building_type: building, use_simple: useSimpleCost }],
    counts,
    costs,
    config.baseCostPercentIncrease,
  );
  const affordable = checkResourceSufficiency(required, balances).sufficient;
  const deposit = missingDeposit(building, BigInt(state.resourcesPacked));
  const reason = !hasAvailableBuildingTile
    ? "No free building plots."
    : (deposit ?? (!affordable ? "Need resources." : needsRoom ? "Need population room." : undefined));
  return { canBuild: reason === undefined, needsRoom, reason };
}

function missingDeposit(building: BuildingType, packed: bigint) {
  const resource = blitzBuildingResource(building);
  const tiers = getResourceTiers(true);
  if (!("materials" in tiers)) throw new Error("Blitz resource catalog unavailable.");
  return resource !== undefined && tiers.materials.includes(resource) && !unpackValue(packed).includes(resource)
    ? `This realm has no ${resourceName(resource)} deposit.`
    : undefined;
}

function readBiomeTroop(context: PageGameContext, realmId: number, config: ClientConfigManager): BlitzTroop | null {
  const origin = readPageEntityPosition(context, realmId);
  const tile = readPageFacts(context, "TileOpt").find(
    (tile) => tile.alt === origin.alt && tile.col === origin.col && tile.row === origin.row,
  );
  if (!tile || !extractTileBiome(BigInt(tile.data))) throw new Error("Realm biome is not synchronized.");
  const biome = biomeTypeOf(extractTileBiome(BigInt(tile.data)));
  const best = TROOP_TYPES.map((type) => ({ type, bonus: config.getBiomeCombatBonus(type, biome) })).reduce(
    (best, troop) => (troop.bonus > best.bonus ? troop : best),
  );
  if (best.bonus <= 1) return null;
  const atTier = (tier: TroopTier) => {
    const resource = getTroopResourceId(best.type, tier);
    return { resource, building: getBuildingFromResource(resource) };
  };
  return {
    type: best.type,
    tiers: {
      [TroopTier.T1]: atTier(TroopTier.T1),
      [TroopTier.T2]: atTier(TroopTier.T2),
      [TroopTier.T3]: atTier(TroopTier.T3),
    },
  };
}

function readSpawnDirections(context: PageGameContext, realmId: number): number[] {
  const origin = readPageEntityPosition(context, realmId);
  const tiles = readPageFacts(context, "TileOpt");
  return getNeighborCoords(origin.col, origin.row, origin.alt).flatMap((neighbor) => {
    const tile = tiles.find((tile) => tile.alt === origin.alt && tile.col === neighbor.x && tile.row === neighbor.y);
    return tile &&
      extractTileBiome(BigInt(tile.data)) &&
      !isPageTileOccupied(context, origin.alt, neighbor.x, neighbor.y, tile)
      ? [neighbor.direction]
      : [];
  });
}

/** ABI numbers come from the shared catalogs, not the quick-army T1 preference table. */
export function buildOrderArmyProps(
  realmId: number,
  troops: NonNullable<BlitzSuggestionDraft["troops"]>,
  direction: number,
) {
  return {
    for_structure_id: realmId,
    category: nativeFactModels.ExplorerTroops.fields.troops.category.enum.indexOf(troops.type),
    slot: 0,
    tier: troopTierIndex(troops.tier),
    amount: BigInt(troops.count) * BigInt(RESOURCE_PRECISION),
    spawn_direction: direction,
  };
}
