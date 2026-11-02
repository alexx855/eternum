import type { BuildOrderPreview } from "./build-order";
import type { GameActionBlockReason } from "./game-status";
import { selectArmyTroop, type RealmTroopBalance } from "./army-troops";
import type { BuildingCostConfig } from "./game-data";

export const LIVE_GAME_REQUEST = "ETERNUM_LIVE_GAME_REQUEST";
export const LIVE_GAME_RESPONSE = "ETERNUM_LIVE_GAME_RESPONSE";

export interface LiveRealm {
  id: number;
  realmId: number;
  level: number;
  troopBalances: RealmTroopBalance[];
  buildings: { innerCol: number; innerRow: number; category: number }[];
  buildingState?: {
    resourcesPacked: string;
    balances: [number, number][];
    population: { current: number; max: number };
  };
  buildingDiagnostic?: string;
}
export interface LiveBuildingConfig {
  costs: BuildingCostConfig[];
  basePopulation: number;
  baseCostPercentIncrease: number;
  useSimpleCost: boolean;
}
export interface LiveArmy {
  id: number;
  home: number;
  category: string;
  count: string;
  tier: string;
  readiness: {
    current: number;
    max: number;
    exploreCost: number;
    travelCosts: Record<number, number | null>;
    position: { col: number; row: number };
  } | null;
  readinessError?: string;
}
export interface LiveActionStatus {
  id: string;
  scope: string;
  kind: LiveGameAction["kind"];
  status: "running" | "completed" | "failed";
  error?: string;
}

export interface LiveGameSnapshot {
  action?: LiveActionStatus;
  scope: string;
  diagnostic?: string;
  blocker: GameActionBlockReason | null;
  realms: LiveRealm[];
  armies: LiveArmy[];
  autoMoving: number[];
  autoMoveEnabled: boolean;
  autoMoveSettings: Record<number, { direction: number; explore: boolean }>;
  buildingConfig?: LiveBuildingConfig;
  buildingDiagnostic?: string;
  buildOrder?: BuildOrderPreview;
  buildOrderDiagnostic?: string;
}
export type LiveGameAction =
  | { kind: "snapshot"; orderJson?: string; realmId?: number }
  | { kind: "create-army"; realmId: number; count: number; direction: number }
  | { kind: "run-build-order"; realmId: number; orderJson: string; expected: string; direction: number }
  | { kind: "move"; armyId: number; direction: number; explore: boolean }
  | { kind: "auto-move"; armyId: number; direction: number; explore: boolean }
  | { kind: "set-auto-move-enabled"; enabled: boolean }
  | { kind: "stop"; armyId: number };
export interface LiveGameRequest {
  id: string;
  scope?: string;
  action: LiveGameAction;
}

export async function createAllRealmArmies(
  snapshot: LiveGameSnapshot,
  count: number,
  direction: number,
  onProgress: (realm: LiveRealm, index: number, total: number) => void,
) {
  const ready = snapshot.realms.filter((realm) => selectArmyTroop(realm.troopBalances, count));
  const failures: { realm: LiveRealm; message: string }[] = [];
  let created = 0;
  for (const [index, realm] of ready.entries()) {
    onProgress(realm, index + 1, ready.length);
    try {
      await requestLiveGame({ kind: "create-army", realmId: realm.id, count, direction }, snapshot.scope);
      created++;
    } catch (error) {
      failures.push({ realm, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, total: ready.length, skipped: snapshot.realms.length - ready.length, failures };
}

/** A request reads the page's current store; the overlay owns only its rendered snapshot. */
export function requestLiveGame(action: LiveGameAction, scope?: string): Promise<LiveGameSnapshot> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false;
    let recoveryId: string | undefined;
    let timeout = setTimeout(recoverAction, 60_000);
    function recoverAction() {
      if (action.kind === "snapshot") {
        finish(new Error("Game client did not respond. Refresh the page."));
        return;
      }
      recoveryId = crypto.randomUUID();
      timeout = setTimeout(
        () => finish(new Error("Game action status unavailable. Refresh before continuing.")),
        60_000,
      );
      document.dispatchEvent(
        new CustomEvent(LIVE_GAME_REQUEST, { detail: { id: recoveryId, action: { kind: "snapshot" } } }),
      );
    }
    function recoverFromSnapshot(snapshot: LiveGameSnapshot | undefined) {
      clearTimeout(timeout);
      const status = snapshot?.action;
      if (!status || status.id !== id || status.scope !== scope) {
        finish(new Error("Game action status unavailable. Refresh before continuing."));
      } else if (status.status === "running") {
        timeout = setTimeout(recoverAction, 3_000);
      } else {
        finish(status.status === "failed" ? new Error(status.error ?? "Game action failed") : undefined, snapshot);
      }
    }
    function finish(error?: Error, snapshot?: LiveGameSnapshot) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      document.removeEventListener(LIVE_GAME_RESPONSE, onResponse);
      if (error) reject(error);
      else if (snapshot) resolve(snapshot);
      else reject(new Error("Invalid game client response"));
    }
    function onResponse(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.id !== id && (!recoveryId || event.detail?.id !== recoveryId)) return;
      if (event.detail.error) finish(new Error(event.detail.error));
      else if (event.detail.id === id) finish(undefined, event.detail.snapshot);
      else recoverFromSnapshot(event.detail.snapshot);
    }
    document.addEventListener(LIVE_GAME_RESPONSE, onResponse);
    document.dispatchEvent(new CustomEvent(LIVE_GAME_REQUEST, { detail: { id, scope, action } }));
  });
}
