import { buildAutomationScope } from "./automation-ownership";
import { GAME_ACTION_BLOCK_MESSAGES, readGameStatus, resolveGameActionBlockReason } from "./game-status";
import { readPageGameConfig, readPageGameContext } from "./page-game-context";

/** Session checks need configuration and account identity, never a presentation snapshot. */
export function readActiveSession() {
  const context = readPageGameContext();
  const config = readPageGameConfig(context);
  const address = context?.account.account.address;
  const connected = Boolean(address && BigInt(address) !== 0n);
  const blocker = resolveGameActionBlockReason(readGameStatus(), connected, config);
  const scope =
    config?.worldAddress && config.rpcUrl && connected
      ? buildAutomationScope(config.rpcUrl, config.worldAddress, config.gameId ?? config.toriiBaseUrl, address!)
      : "unavailable";
  return { context, config, address, blocker, scope };
}

export function requireActiveSession(scope: string | undefined) {
  const session = readActiveSession();
  if (session.blocker) {
    const { title, message } = GAME_ACTION_BLOCK_MESSAGES[session.blocker];
    throw new Error(`${title}. ${message}`);
  }
  if (!session.context || !session.config) throw new Error("Game client unavailable");
  if (!scope || session.scope !== scope) throw new Error("Game or account changed. Refresh extension data.");
  if (session.config.gameId !== session.context.network.provider.gameId)
    throw new Error("Active game configuration does not match the client");
  return { ...session, context: session.context, config: session.config };
}
