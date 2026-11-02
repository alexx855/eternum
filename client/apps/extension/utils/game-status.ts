import type { WorldProfileBase } from "./shared-types";

export type GameStatus = "before-start" | "live" | "ended" | "unavailable";
export type GameActionBlockReason = Exclude<GameStatus, "live"> | "disconnected" | "config-unavailable";

export const GAME_ACTION_BLOCK_MESSAGES: Record<GameActionBlockReason, { title: string; message: string }> = {
  "before-start": { title: "Game Not Started", message: "Actions unlock when the game starts." },
  ended: { title: "Season Ended", message: "This season has concluded. No further actions can be taken." },
  unavailable: { title: "Waiting for game timing", message: "Actions unlock when the game clock is available." },
  disconnected: {
    title: "No Controller Connected",
    message: "Please login to the game first, then reopen this panel.",
  },
  "config-unavailable": {
    title: "World config unavailable",
    message: "Actions unlock when the world configuration is available.",
  },
};

/** The native client renders its registry clock here; it no longer exposes Torii season config. */
export function readGameStatus(): GameStatus {
  if (document.querySelector(".game-finished-pill")) return "ended";

  const clock = document.querySelector('[aria-label="Game clock"]');
  if (!clock) return "unavailable";

  const label = clock.firstElementChild?.textContent?.trim() ?? "";
  if (/^Starts in\b/i.test(label)) return "before-start";
  if (/^No time limit$|\bleft$/i.test(label)) return "live";
  return "unavailable";
}

export function resolveGameActionBlockReason(
  status: GameStatus,
  connected: boolean,
  config: WorldProfileBase | null,
): GameActionBlockReason | null {
  if (status !== "live") return status;
  if (!connected) return "disconnected";
  if (
    !config?.worldAddress.trim() ||
    !config.rpcUrl.trim() ||
    !(config.nativeStoreReady || (config.heraldBaseUrl || config.toriiBaseUrl).trim())
  )
    return "config-unavailable";
  return null;
}

export function assertGameActionsAllowed(connected: boolean, config: WorldProfileBase | null): void {
  const reason = resolveGameActionBlockReason(readGameStatus(), connected, config);
  if (!reason) return;
  const { title, message } = GAME_ACTION_BLOCK_MESSAGES[reason];
  throw new Error(`${title}. ${message}`);
}
