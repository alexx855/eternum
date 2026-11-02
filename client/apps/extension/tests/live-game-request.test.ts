import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_GAME_REQUEST,
  LIVE_GAME_RESPONSE,
  requestLiveGame,
  type LiveGameRequest,
  type LiveGameSnapshot,
} from "../utils/live-game";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("live action recovery", () => {
  it("cleans up recovery when the original action response arrives during a status check", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    vi.stubGlobal("document", target);
    const removeListener = vi.spyOn(target, "removeEventListener");
    let actionId = "";
    target.addEventListener(LIVE_GAME_REQUEST, (event) => {
      const request = (event as CustomEvent<LiveGameRequest>).detail;
      if (request.action.kind !== "snapshot") actionId = request.id;
    });
    const action = requestLiveGame({ kind: "move", armyId: 20, direction: 0, explore: true }, "session");
    await vi.advanceTimersByTimeAsync(60_000);
    target.dispatchEvent(
      new CustomEvent(LIVE_GAME_RESPONSE, { detail: { id: actionId, snapshot: { scope: "session" } } }),
    );
    await expect(action).resolves.toMatchObject({ scope: "session" });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith(LIVE_GAME_RESPONSE, expect.any(Function));
  });
  it.each(["completed", "failed"] as const)(
    "keeps waiting for a long action and recovers its %s outcome",
    async (status) => {
      vi.useFakeTimers();
      const target = new EventTarget();
      vi.stubGlobal("document", target);
      let actionId = "";
      let terminal = false;
      const snapshot = (): LiveGameSnapshot => ({
        scope: "session",
        blocker: null,
        realms: [],
        armies: [],
        autoMoving: [],
        autoMoveEnabled: true,
        autoMoveSettings: {},
        action: {
          id: actionId,
          scope: "session",
          kind: "build-phase",
          status: terminal ? status : "running",
          error: terminal && status === "failed" ? "Insufficient resources" : undefined,
        },
      });
      target.addEventListener(LIVE_GAME_REQUEST, (event) => {
        const request = (event as CustomEvent<LiveGameRequest>).detail;
        if (request.action.kind === "snapshot")
          target.dispatchEvent(
            new CustomEvent(LIVE_GAME_RESPONSE, { detail: { id: request.id, snapshot: snapshot() } }),
          );
        else actionId = request.id;
      });
      const action = requestLiveGame(
        { kind: "build-phase", realmId: 10, phaseId: "phase", phases: [], category: 0 },
        "session",
      );
      const settled = vi.fn();
      void action.then(settled, settled);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).not.toHaveBeenCalled();
      terminal = true;
      const assertion =
        status === "failed"
          ? expect(action).rejects.toThrow("Insufficient resources")
          : expect(action).resolves.toMatchObject({ action: { status } });
      await vi.advanceTimersByTimeAsync(3_000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
