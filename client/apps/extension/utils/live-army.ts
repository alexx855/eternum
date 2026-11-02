import { staminaAt, troopStaminaLimits } from "../../../../packages/core/src/managers/troop-stamina";
import type { NativeRows } from "../../../../contracts/l3/world-native/schema/client.gen";
import type { LiveArmy } from "./live-game";
import {
  readPageArmyTroops,
  readPageEntityPosition,
  readPageFacts,
  readPageRules,
  type PageFacts,
  type PageGameContext,
} from "./page-game-context";
import {
  BASE_MAP_CENTER,
  calculateMoveStaminaCost,
  extractTileBiome,
  getNeighborCoords,
  type StaminaConfig,
} from "./game-data";

/** Presentation is derived from the same confirmed facts and stamina arithmetic as the game. */
export function readLiveArmy(context: PageGameContext, army: PageFacts["ExplorerTroops"]): LiveArmy {
  const result: LiveArmy = {
    id: army.explorer_id,
    home: army.owner,
    category: army.troops.category,
    count: String(army.troops.count),
    tier: army.troops.tier,
    readiness: null,
  };
  try {
    result.readiness = readArmyReadiness(context, army);
  } catch (error) {
    result.readinessError = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function readArmyReadiness(context: PageGameContext, army: PageFacts["ExplorerTroops"]): LiveArmy["readiness"] {
  const rules = readPageRules(context);
  if (!rules) throw new Error("Stamina rules have not synchronized.");
  const tickSeconds = Number(rules.tick_config.armies_tick_in_seconds);
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) throw new Error("Army tick configuration unavailable.");
  const troops = readPageArmyTroops(context, army);
  const current = Number(
    staminaAt(troops, Math.floor(Date.now() / 1000), rules.troop_stamina_config, tickSeconds).amount,
  );
  const max =
    troops.staminaMax ?? troopStaminaLimits(rules.troop_stamina_config, troops.category, troops.tier).staminaMax;
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0)
    throw new Error("Army stamina configuration unavailable.");
  const config = readMovementConfig(rules);
  const origin = readPageEntityPosition(context, army.explorer_id);
  const travelCosts = readTravelCosts(context, origin, config, troops.category);
  return {
    current,
    max,
    exploreCost: config.exploreStaminaCost,
    travelCosts,
    position: { col: origin.col - config.mapCenter, row: origin.row - config.mapCenter },
  };
}

function readTravelCosts(
  context: PageGameContext,
  origin: { alt: boolean; col: number; row: number },
  config: StaminaConfig,
  category: string,
) {
  const tiles = readPageFacts(context, "TileOpt");
  return Object.fromEntries(
    getNeighborCoords(origin.col, origin.row, origin.alt).map((neighbor) => {
      const tile = tiles.find((row) => row.alt === origin.alt && row.col === neighbor.x && row.row === neighbor.y);
      const biome = tile ? extractTileBiome(BigInt(tile.data)) : 0;
      return [
        neighbor.direction,
        biome
          ? calculateMoveStaminaCost({ biome, explore: false, staminaConfig: config, troopCategory: category })
          : null,
      ];
    }),
  );
}

function readMovementConfig(rules: NativeRows["SliceRules"]): StaminaConfig {
  const stamina = rules.troop_stamina_config;
  if (
    ![
      rules.map_center_offset,
      stamina.stamina_explore_stamina_cost,
      stamina.stamina_travel_stamina_cost,
      stamina.stamina_bonus_value,
    ].every(Number.isFinite)
  )
    throw new Error("Movement cost configuration unavailable.");
  return {
    staminaGainPerTick: stamina.stamina_gain_per_tick,
    armiesTickInSeconds: Number(rules.tick_config.armies_tick_in_seconds),
    mapCenter: BASE_MAP_CENTER - rules.map_center_offset,
    exploreStaminaCost: stamina.stamina_explore_stamina_cost,
    travelStaminaCost: stamina.stamina_travel_stamina_cost,
    staminaBonusValue: stamina.stamina_bonus_value,
    maxStamina: {
      knight: stamina.stamina_knight_max,
      paladin: stamina.stamina_paladin_max,
      crossbowman: stamina.stamina_crossbowman_max,
    },
  };
}
