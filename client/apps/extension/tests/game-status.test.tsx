// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStatus } from "../hooks/useGameStatus";
import { assertGameActionsAllowed, readGameStatus, resolveGameActionBlockReason } from "../utils/game-status";
import type { WorldProfileBase } from "../utils/shared-types";

const hookState = vi.hoisted(() => ({
  setStatus: vi.fn(),
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock("react", () => ({
  useState: (initial: () => unknown) => [initial(), hookState.setStatus],
  useEffect: (effect: () => () => void) => {
    hookState.cleanup = effect();
  },
}));

let clockLabel: string | null = null;
let finished = false;

const config: WorldProfileBase = {
  worldAddress: "0x123",
  rpcUrl: "https://rpc.example.com",
  toriiBaseUrl: "https://torii.example.com",
};

function mountClock(label: string) {
  clockLabel = label;
  return {
    value: {
      set textContent(value: string) {
        clockLabel = value;
      },
    },
  };
}

beforeEach(() => {
  clockLabel = null;
  finished = false;
  hookState.setStatus.mockClear();
  vi.stubGlobal("document", {
    body: {},
    querySelector: (selector: string) => {
      if (selector === ".game-finished-pill") return finished ? {} : null;
      return clockLabel === null ? null : { firstElementChild: { textContent: clockLabel } };
    },
  });
});
afterEach(() => {
  hookState.cleanup?.();
  hookState.cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("game clock status", () => {
  it.each([
    ["Starts in 6m 09s", "before-start"],
    ["STARTS IN 6M 09S", "before-start"],
    ["57m 40s left", "live"],
    ["57M 40S LEFT", "live"],
    ["No time limit", "live"],
    ["Clock unavailable", "unavailable"],
    ["", "unavailable"],
    ["Unrecognized timing", "unavailable"],
  ])("reads %s as %s", (label, expected) => {
    mountClock(label);
    expect(readGameStatus()).toBe(expected);
  });
  it("blocks when the clock is missing", () => {
    expect(readGameStatus()).toBe("unavailable");
    expect(() => assertGameActionsAllowed(true, config)).toThrow("Waiting for game timing");
  });
  it("reads the finished pill after the clock has been replaced", () => {
    finished = true;
    expect(readGameStatus()).toBe("ended");
  });
});

describe("action availability", () => {
  it.each(["before-start", "ended", "unavailable"] as const)(
    "prioritizes %s over connection and config failures",
    (status) => expect(resolveGameActionBlockReason(status, false, null)).toBe(status),
  );
  it("requires a connected account", () => {
    expect(resolveGameActionBlockReason("live", false, config)).toBe("disconnected");
  });
  it("requires a world profile", () => {
    expect(resolveGameActionBlockReason("live", true, null)).toBe("config-unavailable");
  });
  it.each(["worldAddress", "rpcUrl", "toriiBaseUrl"] as const)("requires a nonempty %s", (field) => {
    for (const value of ["", "   "]) {
      expect(resolveGameActionBlockReason("live", true, { ...config, [field]: value })).toBe("config-unavailable");
    }
  });
  it("allows a live game with a connected account and complete config", () => {
    expect(resolveGameActionBlockReason("live", true, config)).toBeNull();
  });
  it("rechecks clock and configuration on subsequent submissions", () => {
    const { value } = mountClock("57m 40s left");
    expect(() => assertGameActionsAllowed(true, config)).not.toThrow();
    expect(() => assertGameActionsAllowed(true, null)).toThrow("World config unavailable");
    value.textContent = "Starts in 6m 09s";
    expect(() => assertGameActionsAllowed(true, config)).toThrow("Game Not Started");
    value.textContent = "57m 40s left";
    expect(() => assertGameActionsAllowed(false, config)).toThrow("No Controller Connected");
  });
});

describe("clock observation", () => {
  it("observes timing text, attributes, and clock replacement, and disconnects on unmount", () => {
    let notify!: () => void;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    expect(useGameStatus()).toBe("unavailable");
    expect(observe).toHaveBeenCalledWith(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "class"],
      subtree: true,
    });
    for (const [label, expected] of [
      ["Starts in 6m 09s", "before-start"],
      ["57m 40s left", "live"],
      [null, "unavailable"],
      ["Starts in 2m 00s", "before-start"],
    ]) {
      clockLabel = label;
      notify();
      expect(hookState.setStatus).toHaveBeenLastCalledWith(expected);
    }
    hookState.cleanup?.();
    hookState.cleanup = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
