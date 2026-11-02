import { retainAutomationOwnership } from "./automation-ownership";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import { selectArmyTroop } from "./army-troops";
import { submitClientAction, ClientConfirmationUnavailableError } from "./client-submission";
import { readLiveArmy } from "./live-army";
import { extractTileBiome, getNeighborCoords } from "./game-data";
import { resolveFreeBuildingSlots } from "./building-placement";
import { readPageBuildOrder, buildOrderArmyProps } from "./page-build-order";
import { readPageBuildingConfig, readPageRealmBuildingState } from "./page-building-state";
import { readActiveSession, requireActiveSession } from "./page-game-session";
import {
  LIVE_GAME_REQUEST,
  LIVE_GAME_RESPONSE,
  type LiveGameAction,
  type LiveGameRequest,
  type LiveGameSnapshot,
  type LiveActionStatus,
  type LiveRealm,
} from "./live-game";
import {
  readPageEntityPosition,
  readPageFacts,
  readPageRealmTroops,
  isPageTileOccupied,
  type PageGameContext,
} from "./page-game-context";

interface AutoMoveRun {
  stopped: boolean;
  scope: string;
  direction: number;
  explore: boolean;
}
const moving = new Map<number, AutoMoveRun>();
let autoMoveEnabled = true;
let autoMoveGeneration = 0;
let activeScope: string | undefined;
let pending = false;
let awaitingActionFacts: { scope: string; ready: () => boolean } | undefined;
let lastAction: LiveActionStatus | undefined;

export function installLiveGameBridge() {
  document.addEventListener(LIVE_GAME_REQUEST, (event) => {
    if (!(event instanceof CustomEvent)) return;
    const request = event.detail as LiveGameRequest;
    if (!request?.id || !request.action) return;
    void handleRequest(request).then(
      (snapshot) => respond(request.id, { snapshot }),
      (error) => respond(request.id, { error: error instanceof Error ? error.message : String(error) }),
    );
  });
}

function respond(id: string, result: { snapshot?: LiveGameSnapshot; error?: string }) {
  document.dispatchEvent(new CustomEvent(LIVE_GAME_RESPONSE, { detail: { id, ...result } }));
}

function observeSession({ scope, blocker }: ReturnType<typeof readActiveSession>) {
  if (blocker || activeScope !== scope) {
    awaitingActionFacts = undefined;
    activeScope = scope;
    autoMoveGeneration++;
  }
  for (const run of moving.values()) {
    if (blocker || run.scope !== scope) run.stopped = true;
  }
}

function readSnapshot(order?: { orderJson?: string; realmId?: number }): LiveGameSnapshot {
  const session = readActiveSession();
  const { context, config, address, blocker, scope } = session;
  if (blocker || !context) return buildBlockedSnapshot(session);
  if (config?.gameId !== context.network.provider.gameId)
    throw new Error("Active game configuration does not match the client");
  const realms = readOwnedRealms(context, address!);
  const homes = new Set(realms.map((realm) => realm.id));
  const armies = readPageFacts(context, "ExplorerTroops")
    .filter((row) => homes.has(row.owner) && BigInt(row.troops.count) > 0n)
    .map((row) => readLiveArmy(context, row));
  const activeRuns = [...moving.entries()].filter(([, run]) => !run.stopped && run.scope === scope);
  return {
    scope,
    action: lastAction?.scope === scope ? lastAction : undefined,
    blocker: null,
    realms: realms.map((realm) => readRealmRequirements(context, realm)),
    ...readBuildingConfiguration(context),
    ...readOrderPreview(context, scope, realms, order),
    armies,
    autoMoving: activeRuns.map(([id]) => id),
    autoMoveEnabled,
    autoMoveSettings: Object.fromEntries(
      activeRuns.map(([id, run]) => [id, { direction: run.direction, explore: run.explore }]),
    ),
  };
}

function buildBlockedSnapshot({
  context,
  config,
  blocker,
  scope,
}: ReturnType<typeof readActiveSession>): LiveGameSnapshot {
  return {
    scope,
    action: lastAction?.scope === scope ? lastAction : undefined,
    blocker: blocker ?? "config-unavailable",
    diagnostic: !context
      ? "Waiting for the game provider"
      : !config
        ? "Active game profile unavailable"
        : !config.rpcUrl
          ? "Game RPC URL unavailable"
          : !config.worldAddress
            ? "World address unavailable"
            : "Game data endpoint unavailable",
    realms: [],
    armies: [],
    autoMoving: [],
    autoMoveEnabled,
    autoMoveSettings: {},
  };
}

function readOwnedRealms(context: PageGameContext, address: string): LiveRealm[] {
  const structures = readPageFacts(context, "Structure").filter(
    (row) => BigInt(row.owner) === BigInt(address) && row.base.category === 1,
  );
  const buildings = readPageFacts(context, "Building");
  const troopBalances = readPageRealmTroops(
    context,
    structures.map((row) => row.entity_id),
  );
  return structures.map((row) => {
    return {
      id: row.entity_id,
      realmId: row.metadata.realm_id,
      level: row.base.level,
      troopBalances: troopBalances.get(row.entity_id) ?? [],
      buildings: buildings
        .filter((building) => building.structure_id === row.entity_id)
        .map((building) => ({
          innerCol: building.inner_col,
          innerRow: building.inner_row,
          category: building.category,
        })),
    };
  });
}

function readBuildingConfiguration(context: PageGameContext) {
  let buildingConfig: LiveGameSnapshot["buildingConfig"];
  let buildingDiagnostic: string | undefined;
  try {
    buildingConfig = readPageBuildingConfig(context);
  } catch (error) {
    buildingDiagnostic = error instanceof Error ? error.message : String(error);
  }
  return { buildingConfig, buildingDiagnostic };
}

function readRealmRequirements(context: PageGameContext, realm: LiveRealm): LiveRealm {
  try {
    return { ...realm, buildingState: readPageRealmBuildingState(context, realm.id) };
  } catch (error) {
    return { ...realm, buildingDiagnostic: error instanceof Error ? error.message : String(error) };
  }
}

function readOrderPreview(
  context: PageGameContext,
  scope: string,
  realms: LiveRealm[],
  order?: { orderJson?: string; realmId?: number },
) {
  let buildOrder: LiveGameSnapshot["buildOrder"];
  let buildOrderDiagnostic: string | undefined;
  if (order?.orderJson) {
    try {
      const realm = realms.find((realm) => realm.id === order.realmId) ?? realms[0];
      if (!realm) throw new Error("No owned realms are synchronized.");
      buildOrder = readPageBuildOrder(context, realm, order.orderJson);
      if (awaitingActionFacts?.scope === scope) {
        if (awaitingActionFacts.ready()) awaitingActionFacts = undefined;
        else buildOrder.blocker = "Previous action is still waiting for game facts. No further action will be sent.";
      }
    } catch (error) {
      buildOrderDiagnostic = error instanceof Error ? error.message : String(error);
    }
  }
  return { buildOrder, buildOrderDiagnostic };
}

function requireActingContext(scope: string | undefined): PageGameContext {
  const session = requireActiveSession(scope);
  observeSession(session);
  return session.context;
}

/** Provider retries call this proxy again, so a queued legacy submission cannot outlive its gate or account. */
function guardedSigner(context: PageGameContext, scope: string, guard?: () => void) {
  const account = context.account.account;
  return new Proxy(account, {
    get(target, key) {
      if (key === "address") {
        requireActingContext(scope);
        guard?.();
      }
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        requireActingContext(scope);
        guard?.();
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function requirePreviousActionFacts(scope: string) {
  if (awaitingActionFacts?.scope !== scope) return;
  if (!awaitingActionFacts.ready())
    throw new Error("Previous action is still waiting for game facts. Refresh before continuing.");
  awaitingActionFacts = undefined;
}

async function submit(scope: string, method: string, props: Record<string, unknown>, guard?: () => void) {
  requirePreviousActionFacts(scope);
  const context = requireActingContext(scope);
  const call = context.systemCalls[method];
  if (!call) throw new Error(`Client action unavailable: ${method}`);
  guard?.();
  const receipt = await submitClientAction(context.network.provider, () =>
    call({ ...props, signer: guardedSigner(context, scope, guard) }),
  );
  requireActingContext(scope);
  return receipt;
}

async function handleRequest(request: LiveGameRequest): Promise<LiveGameSnapshot> {
  observeSession(readActiveSession());
  const { action } = request;
  if (action.kind === "snapshot") return readSnapshot(action);
  if (action.kind === "stop") {
    const run = moving.get(action.armyId);
    if (run) run.stopped = true;
    return readSnapshot();
  }
  if (action.kind === "set-auto-move-enabled" && !action.enabled) {
    autoMoveEnabled = false;
    autoMoveGeneration++;
    for (const run of moving.values()) run.stopped = true;
    return readSnapshot();
  }
  const scope = request.scope;
  if (!scope) throw new Error("Game scope unavailable");
  requireActingContext(scope);
  validateAction(action);
  if (action.kind === "set-auto-move-enabled") {
    autoMoveEnabled = action.enabled;
    return readSnapshot();
  }
  if (action.kind === "auto-move" && !autoMoveEnabled) throw new Error("Enable the Auto Move master toggle first.");
  if (pending) throw new Error("Another extension action is still confirming");
  pending = true;
  lastAction = { id: request.id, scope, kind: action.kind, status: "running" };
  try {
    await executeAction(action, scope);
    lastAction = { ...lastAction, status: "completed" };
    return readSnapshot(action.kind === "run-build-order" ? action : undefined);
  } catch (error) {
    lastAction = { ...lastAction, status: "failed", error: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    pending = false;
  }
}

function requireRealm(id: number) {
  const realm = readSnapshot().realms.find((candidate) => candidate.id === id);
  if (!realm) throw new Error("Realm is not owned by the connected account");
  return realm;
}

async function executeAction(action: LiveGameAction, scope: string) {
  if (action.kind === "create-army") return createArmy(scope, action);
  if (action.kind === "run-build-order") return runBuildOrder(scope, action);
  if (action.kind === "move" || action.kind === "auto-move") return runArmyMovement(scope, action);
  throw new Error("Unsupported extension action");
}

async function runArmyMovement(scope: string, action: Extract<LiveGameAction, { kind: "move" | "auto-move" }>) {
  const generation = autoMoveGeneration;
  if (moving.get(action.armyId)?.stopped === false) throw new Error("This army is already moving automatically");
  // Register before either asynchronous boundary so Stop can cancel a starting run too.
  const run =
    action.kind === "auto-move"
      ? { stopped: false, scope, direction: action.direction, explore: action.explore }
      : undefined;
  if (run) moving.set(action.armyId, run);
  let release: (() => Promise<void>) | undefined;
  let retained = false;
  try {
    release = await retainAutomationOwnership(requireActiveSession(scope).scope);
    if (wasAutoMoveCancelled(action, generation, run)) return;
    const guard = () => {
      if (wasAutoMoveCancelled(action, generation, run)) throw new Error("Auto Move stopped before submission");
    };
    await moveArmy(scope, action, guard);
    if (run && !wasAutoMoveCancelled(action, generation, run)) {
      startAutoMove(scope, action, release, run, guard);
      retained = true;
    }
  } finally {
    if (!retained) {
      if (run && moving.get(action.armyId) === run) moving.delete(action.armyId);
      await release?.();
    }
  }
}

function wasAutoMoveCancelled(action: LiveGameAction, generation: number, run?: AutoMoveRun) {
  return action.kind === "auto-move" && (!autoMoveEnabled || generation !== autoMoveGeneration || run?.stopped);
}

function requireSpawnTile(scope: string, realmId: number, direction: number) {
  const context = requireActingContext(scope);
  const origin = readPageEntityPosition(context, realmId);
  const neighbor = getNeighborCoords(origin.col, origin.row, origin.alt).find((tile) => tile.direction === direction)!;
  const tile = readPageFacts(context, "TileOpt").find(
    (row) => row.alt === origin.alt && row.col === neighbor.x && row.row === neighbor.y,
  );
  if (!tile || !extractTileBiome(BigInt(tile.data)))
    throw new Error("Choose an explored tile next to the realm before spawning an army.");
  const occupied = isPageTileOccupied(context, origin.alt, neighbor.x, neighbor.y, tile);
  if (occupied) throw new Error("Spawn tile occupied. Choose another direction.");
}

async function createArmy(scope: string, action: Extract<LiveGameRequest["action"], { kind: "create-army" }>) {
  const realm = requireRealm(action.realmId);
  requireSpawnTile(scope, action.realmId, action.direction);
  if (!Number.isSafeInteger(action.count) || action.count < 1)
    throw new Error("Troop count must be a positive integer");
  const troop = selectArmyTroop(realm.troopBalances, action.count);
  if (!troop) throw new Error(`Realm ${realm.id} does not have enough T1 troops (need ${action.count})`);
  const existing = new Set(readSnapshot().armies.map((army) => army.id));
  await submitFactAction(
    scope,
    "explorer_create",
    {
      for_structure_id: action.realmId,
      slot: 0,
      category: troop.category,
      tier: 0,
      amount: BigInt(action.count) * BigInt(RESOURCE_PRECISION),
      spawn_direction: action.direction,
    },
    undefined,
    () => readSnapshot().armies.some((army) => army.home === action.realmId && !existing.has(army.id)),
    "Army",
  );
}

type RunBuildOrder = Extract<LiveGameAction, { kind: "run-build-order" }>;
type OrderPlan = ReturnType<typeof requireOrderPlan>;

function requireOrderPlan(scope: string, action: RunBuildOrder) {
  const realm = requireRealm(action.realmId);
  const preview = readPageBuildOrder(requireActingContext(scope), realm, action.orderJson);
  if (!preview.next || preview.expected !== action.expected)
    throw new Error("The next action changed. Refresh the order before continuing.");
  if (preview.blocker) throw new Error(preview.blocker);
  return { ...preview, next: preview.next };
}

async function runBuildOrder(scope: string, action: RunBuildOrder) {
  const preview = requireOrderPlan(scope, action);
  const guard = () => {
    requireOrderPlan(scope, action);
  };
  if (preview.next.action === "build") return buildOrderBuilding(scope, action.realmId, preview, guard);
  if (preview.next.action === "upgrade") return upgradeOrderRealm(scope, action.realmId, guard);
  return deployOrderArmy(scope, action, preview, guard);
}

async function buildOrderBuilding(scope: string, realmId: number, preview: OrderPlan, guard: () => void) {
  const category = preview.next.buildingTypeHint;
  if (category === undefined) throw new Error("Build order building unavailable.");
  const realm = requireRealm(realmId);
  const slot = resolveFreeBuildingSlots(realm, realm.buildings)[0];
  if (!slot) throw new Error("No free building plots.");
  await submitFactAction(
    scope,
    "create_building",
    {
      entity_id: realm.id,
      directions: slot.directions,
      building_category: category,
      use_simple: preview.useSimpleCost,
    },
    () => {
      guard();
      requireOrderBuildingSlot(realmId, slot);
    },
    () =>
      readPageFacts(requireActingContext(scope), "Building").some(
        (row) =>
          row.structure_id === realmId &&
          row.inner_col === slot.innerCol &&
          row.inner_row === slot.innerRow &&
          row.category === category,
      ),
    "Building",
  );
}

function requireOrderBuildingSlot(realmId: number, slot: { innerCol: number; innerRow: number }) {
  const current = requireRealm(realmId);
  const free = resolveFreeBuildingSlots(current, current.buildings);
  if (!free.some((candidate) => candidate.innerCol === slot.innerCol && candidate.innerRow === slot.innerRow))
    throw new Error("The building plot changed. Refresh the order before continuing.");
}

async function upgradeOrderRealm(scope: string, realmId: number, guard: () => void) {
  const level = requireRealm(realmId).level;
  await submitFactAction(
    scope,
    "upgrade_realm",
    { realm_entity_id: realmId },
    guard,
    () =>
      readPageFacts(requireActingContext(scope), "Structure").some(
        (row) => row.entity_id === realmId && row.base.level > level,
      ),
    "Realm upgrade",
  );
}

async function deployOrderArmy(scope: string, action: RunBuildOrder, preview: OrderPlan, guard: () => void) {
  requireSpawnTile(scope, action.realmId, action.direction);
  const troops = preview.next.troops;
  if (!troops) throw new Error("Build order army unavailable.");
  const existing = new Set(
    readPageFacts(requireActingContext(scope), "ExplorerTroops").map((army) => army.explorer_id),
  );
  await submitFactAction(
    scope,
    "explorer_create",
    buildOrderArmyProps(action.realmId, troops, action.direction),
    () => {
      guard();
      requireSpawnTile(scope, action.realmId, action.direction);
    },
    () =>
      readPageFacts(requireActingContext(scope), "ExplorerTroops").some(
        (army) =>
          army.owner === action.realmId &&
          !existing.has(army.explorer_id) &&
          army.troops.category === troops.type &&
          army.troops.tier === troops.tier &&
          BigInt(army.troops.count) >= BigInt(troops.count) * BigInt(RESOURCE_PRECISION),
      ),
    "Army",
  );
}

async function submitFactAction(
  scope: string,
  method: string,
  props: Record<string, unknown>,
  guard: (() => void) | undefined,
  ready: () => boolean,
  label: string,
) {
  try {
    await submit(scope, method, props, guard);
  } catch (error) {
    if (error instanceof ClientConfirmationUnavailableError) awaitingActionFacts = { scope, ready };
    throw error;
  }
  awaitingActionFacts = { scope, ready };
  await waitForFacts(scope, ready, label);
  awaitingActionFacts = undefined;
}

async function waitForFacts(scope: string, ready: () => boolean, label: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    requireActingContext(scope);
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} submitted but updated game facts have not arrived. Refresh before continuing.`);
}

async function moveArmy(
  scope: string,
  action: { armyId: number; direction: number; explore: boolean },
  guard?: () => void,
) {
  if (!readSnapshot().armies.some((army) => army.id === action.armyId))
    throw new Error("Army is not owned by the connected account");
  const origin = readPageEntityPosition(requireActingContext(scope), action.armyId);
  await submitFactAction(
    scope,
    action.explore ? "explorer_explore" : "explorer_travel",
    {
      explorer_id: action.armyId,
      directions: [action.direction],
    },
    guard,
    () => {
      const current = readPageEntityPosition(requireActingContext(scope), action.armyId);
      return current.alt !== origin.alt || current.col !== origin.col || current.row !== origin.row;
    },
    "Army movement",
  );
}

function startAutoMove(
  scope: string,
  action: { armyId: number; direction: number; explore: boolean },
  release: () => Promise<void>,
  run: AutoMoveRun,
  guard: () => void,
) {
  void (async () => {
    try {
      while (!run.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        if (run.stopped) break;
        requireActingContext(scope);
        if (pending) continue;
        pending = true;
        try {
          await moveArmy(scope, action, guard);
        } finally {
          pending = false;
        }
      }
    } catch (error) {
      respond("auto-move", {
        error: `Army ${action.armyId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (moving.get(action.armyId) === run) moving.delete(action.armyId);
      await release();
    }
  })().catch((error) => respond("auto-move", { error: String(error) }));
}

function validateAction(action: LiveGameRequest["action"]) {
  if ("direction" in action && (!Number.isInteger(action.direction) || action.direction < 0 || action.direction > 5))
    throw new Error("Invalid direction");
}
