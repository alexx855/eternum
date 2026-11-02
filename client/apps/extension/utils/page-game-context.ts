import { safeInteger } from "../../../../packages/core/src/utils/safe-integer";
import type { Troops } from "@bibliothecadao/types";
import type { NativeFactStore } from "../../../../packages/core/src/client/native-fact-store";
import { resolveExplorerTroops } from "../../../../packages/core/src/managers/troop-stamina";
import { isRecord } from "./type-guards";
import { parseWorldProfileBase } from "./config";
import type { WorldProfileBase } from "./shared-types";
import { T1_TROOPS, type RealmTroopBalance } from "./army-troops";
import { RESOURCE_COLUMN_MAP } from "./game-data";

import type { NativeRows } from "../../../../contracts/l3/world-native/schema/client.gen";

type FactRow = Record<string, unknown>;
interface RawPageFacts {
  Structure: NativeRows["Structure"] & { base: { coord_x?: number; coord_y?: number; coord_alt?: boolean } };
  ExplorerTroops: Omit<NativeRows["ExplorerTroops"], "troops" | "owner"> & {
    owner: number;
    coord?: { alt: boolean; x: number; y: number };
    troops: Omit<NativeRows["ExplorerTroops"]["troops"], "stamina"> & {
      stamina: NativeRows["ExplorerTroops"]["troops"]["stamina"] | Troops["stamina"];
    };
  };
  SliceRules: NativeRows["SliceRules"];
  TileOpt: NativeRows["TileOpt"];
  TileOccupancy: NativeRows["TileOccupancy"];
  Building: NativeRows["Building"] & { outer_entity_id?: number };
  ResourceBalance: NativeRows["ResourceBalance"];
  Resource: Record<string, unknown> & {
    entity_id: number;
    weight: { capacity: bigint; weight: bigint };
  };
  StructureBuildings: NativeRows["StructureBuildings"];
  ResourceProduction: NativeRows["ResourceProduction"];
  ResourceWeight: NativeRows["ResourceWeight"];
  ResourceRule: NativeRows["ResourceRule"];
  BuildingRule: NativeRows["BuildingRule"];
  GameRegistry: { game_id: number; preset_id: number };
}
type NumericEntityIds<T> = {
  [K in keyof T]: K extends "entity_id" | "structure_id" | "explorer_id" ? number : T[K];
};
export type PageFacts = { [M in keyof RawPageFacts]: NumericEntityIds<RawPageFacts[M]> };

interface ReactFiber {
  memoizedProps?: { value?: unknown };
  return?: ReactFiber;
  alternate?: ReactFiber;
  stateNode?: { current?: ReactFiber };
}
export interface PageProvider {
  on?: (event: string, listener: (payload: unknown) => void) => unknown;
  off?: (event: string, listener: (payload: unknown) => void) => unknown;
  gameId: number;
  contracts?: { world?: string };
  provider?: { channel?: { nodeUrl?: string } };
}
export interface PageGameContext {
  network: { provider: PageProvider; contractComponents?: Record<string, { values: unknown }> };
  store?: {
    inGame(model: string, gameId: number): Iterable<FactRow>;
    subscriptionScope?: () => { known?: unknown };
  };
  account: { account: { address: string } };
  systemCalls: Record<string, (props: Record<string, unknown>) => Promise<unknown>>;
}

/**
 * The deployed client has no extension API. Isolate its React provider discovery here so changes to its host
 * integration cannot leak into action planning. We only read the provider; Herald remains the sole fact writer.
 */
export function readPageGameContext(): PageGameContext | null {
  const clock = document.querySelector('[aria-label="Game clock"]');
  if (!clock) return null;
  const key = Object.keys(clock).find((name) => name.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = (clock as unknown as Record<string, ReactFiber | undefined>)[key];
  let root = fiber;
  while (root?.return) root = root.return;
  if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate;
  while (fiber) {
    const value = fiber.memoizedProps?.value;
    if (isPageGameContext(value)) return value;
    fiber = fiber.return;
  }
  return null;
}

/** Native clients keep deployment config on the installed provider, rather than in WORLD_PROFILES. */
export function readPageGameConfig(context: PageGameContext | null): WorldProfileBase | null {
  if (!context?.store) return parseWorldProfileBase();
  const provider = context.network.provider;
  return {
    worldAddress: provider.contracts?.world ?? "",
    rpcUrl: provider.provider?.channel?.nodeUrl ?? "",
    toriiBaseUrl: "",
    gameId: provider.gameId,
    nativeStoreReady: Boolean(context.store.subscriptionScope?.().known),
  };
}

/** Reads either the native store or the deployed client's Herald-backed contract components, never overrides. */
export function readPageFacts<M extends keyof PageFacts>(context: PageGameContext, model: M): PageFacts[M][] {
  const gameId = context.network.provider.gameId;
  if (!Number.isSafeInteger(gameId) || gameId < 1) throw new Error("Game scope unavailable");
  if (context.store) return [...context.store.inGame(model, gameId)].map((row) => normalizePageEntityIds(model, row));
  const rows = readPageComponentRows(context, model, "game_id", gameId);
  if (model === "Building")
    return rows.map((row) => ({
      ...row,
      structure_id: row.structure_id ?? row.outer_entity_id,
    })) as unknown as PageFacts[M][];
  return rows.map((row) => normalizePageEntityIds(model, row));
}

/** Keep the overlay's numeric IDs exact at the native boundary; wallet addresses stay bigint. */
function normalizePageEntityIds<M extends keyof PageFacts>(model: M, row: FactRow): PageFacts[M] {
  const fields = ["entity_id", "structure_id", "explorer_id", ...(model === "ExplorerTroops" ? ["owner"] : [])];
  const normalized = { ...row };
  for (const field of fields) {
    const value = normalized[field];
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "string")
      normalized[field] = safeInteger(value);
  }
  return normalized as PageFacts[M];
}

/** Preset-owned components have a preset_id rather than a game_id. Always filter at the adapter boundary. */
function readPageComponentRows(context: PageGameContext, model: string, scopeField: string, scopeId: number) {
  const component = context.network.contractComponents?.[model];
  if (!component) throw new Error(`Game facts unavailable: ${model}`);
  const fields = collectFields(component.values);
  const scopeIds = fields.find(([path]) => path.join(".") === scopeField)?.[1];
  if (!scopeIds) throw new Error(`Game facts have no scope: ${model}`);
  return [...scopeIds.entries()]
    .filter(([, id]) => id === scopeId)
    .map(([entity]) => {
      const row: FactRow = {};
      for (const [path, values] of fields) assignField(row, path, values.get(entity));
      return row;
    });
}

export function readPagePresetRows<T>(context: PageGameContext, model: string): T[] {
  const game = readPageFacts(context, "GameRegistry")[0];
  if (!game?.preset_id) throw new Error("Active game preset is not synchronized.");
  return readPageComponentRows(context, model, "preset_id", game.preset_id) as unknown as T[];
}

function collectFields(value: unknown, path: string[] = []): [string[], Map<unknown, unknown>][] {
  if (value instanceof Map) return [[path, value]];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => collectFields(child, [...path, ...key.split(".")]));
}

export function readPageRealmTroops(
  context: PageGameContext,
  realmIds: readonly number[] = [],
): Map<number, RealmTroopBalance[]> {
  const balances = new Map<number, RealmTroopBalance[]>();
  if (context.store) {
    for (const row of readPageFacts(context, "ResourceBalance")) {
      if (!T1_TROOPS.some((troop) => troop.resourceId === row.resource_type)) continue;
      const troops = balances.get(row.entity_id) ?? [];
      troops.push({ resourceId: row.resource_type, balance: String(row.balance) });
      balances.set(row.entity_id, troops);
    }
  } else {
    for (const row of readPageFacts(context, "Resource")) {
      balances.set(
        row.entity_id,
        T1_TROOPS.map((troop) => {
          const column = RESOURCE_COLUMN_MAP[troop.resourceId];
          const balance = column ? row[column] : undefined;
          if (typeof balance !== "bigint") throw new Error(`Troop balance unavailable: ${row.entity_id} ${troop.name}`);
          return { resourceId: troop.resourceId, balance: String(balance) };
        }),
      );
    }
  }
  for (const realmId of realmIds) {
    if (balances.has(realmId)) continue;
    if (!context.store) throw new Error(`Troop balances unavailable: realm ${realmId}`);
    balances.set(realmId, []);
  }
  return balances;
}

function assignField(row: FactRow, path: string[], value: unknown) {
  let target = row;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(target[key])) target[key] = {};
    target = target[key] as FactRow;
  }
  target[path.at(-1)!] = value;
}

function isPageGameContext(value: unknown): value is PageGameContext {
  return (
    isRecord(value) &&
    isRecord(value.network) &&
    isRecord(value.network.provider) &&
    isRecord(value.systemCalls) &&
    isRecord(value.account) &&
    isRecord(value.account.account)
  );
}

export function readPageEntityPosition(context: PageGameContext, entityId: number) {
  if (context.store) {
    const tile = readPageFacts(context, "TileOccupancy").find((row) => row.entity_id === entityId);
    if (tile) return { alt: tile.alt, col: tile.col, row: tile.row };
  } else {
    const army = readPageFacts(context, "ExplorerTroops").find((row) => row.explorer_id === entityId);
    if (army?.coord) return { alt: army.coord.alt, col: army.coord.x, row: army.coord.y };
    const realm = readPageFacts(context, "Structure").find((row) => row.entity_id === entityId);
    if (realm?.base.coord_x !== undefined && realm.base.coord_y !== undefined)
      return { alt: realm.base.coord_alt ?? false, col: realm.base.coord_x, row: realm.base.coord_y };
  }
  throw new Error(`Game position unavailable: ${entityId}`);
}

export function readPageRules(context: PageGameContext): PageFacts["SliceRules"] {
  const rules = context.store
    ? readPageFacts(context, "SliceRules")[0]
    : readPagePresetRows<PageFacts["SliceRules"]>(context, "PresetConfig")[0];
  if (!rules) throw new Error("Game rules are not synchronized.");
  return rules;
}

export function isPageTileOccupied(
  context: PageGameContext,
  alt: boolean,
  col: number,
  row: number,
  tile: PageFacts["TileOpt"],
): boolean {
  if (!context.store) return ((BigInt(tile.data) >> 9n) & 0xffffffffn) !== 0n;
  return readPageFacts(context, "TileOccupancy").some(
    (position) => position.alt === alt && position.col === col && position.row === row && position.entity_id !== 0,
  );
}

export function readPageArmyTroops(context: PageGameContext, army: PageFacts["ExplorerTroops"]): Troops {
  if (context.store) {
    const troops = resolveExplorerTroops(
      context.store as NativeFactStore,
      {
        ...army,
        explorer_id: BigInt(army.explorer_id),
        owner: BigInt(army.owner),
      } as NativeRows["ExplorerTroops"],
    );
    if (!troops) throw new Error("Army stamina has not synchronized.");
    return troops;
  }
  const stamina = army.troops.stamina;
  if (!("amount" in stamina)) throw new Error("Army stamina format unavailable.");
  return { ...army.troops, stamina };
}
