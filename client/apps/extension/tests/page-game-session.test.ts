import { afterEach, describe, expect, it, vi } from "vitest";
import { readActiveSession, requireActiveSession } from "../utils/page-game-session";

const state = vi.hoisted(() => ({
  config: { worldAddress: "0x123", rpcUrl: "https://rpc", gameId: 39, toriiBaseUrl: "", nativeStoreReady: true },
  context: { account: { account: { address: "0x1" } }, network: { provider: { gameId: 39 } } },
}));
vi.mock("../utils/page-game-context", () => ({
  readPageGameContext: () => state.context,
  readPageGameConfig: () => state.config,
}));
afterEach(() => {
  state.config.rpcUrl = "https://rpc";
  state.context.account.account.address = "0x1";
  vi.unstubAllGlobals();
});
function liveClock() {
  vi.stubGlobal("document", {
    querySelector: (selector: string) =>
      selector === ".game-finished-pill" ? null : { firstElementChild: { textContent: "10m left" } },
  });
}
describe("active game session", () => {
  it("invalidates actions when the network changes with the same world, game and account", () => {
    liveClock();
    const scope = readActiveSession().scope;
    state.config.rpcUrl = "https://other-rpc";
    expect(() => requireActiveSession(scope)).toThrow("changed");
  });
  it("normalizes equivalent addresses and a trailing network slash", () => {
    liveClock();
    const scope = readActiveSession().scope;
    state.context.account.account.address = "0x0001";
    state.config.rpcUrl = "https://rpc/";
    expect(requireActiveSession(scope).scope).toBe(scope);
  });
  it("checks eligibility without reading game entity models", () => {
    liveClock();
    expect(requireActiveSession(readActiveSession().scope).context).toBe(state.context);
  });
});
