import type { PageGameContext } from "../utils/page-game-context";
import type { LiveGameSnapshot } from "../utils/live-game";
type QueuedSigner = { signer: { execute(calls: unknown[]): Promise<unknown> } };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESOURCE_PRECISION, BuildingType } from "@bibliothecadao/types";
import { farm, orderFixture } from "./build-order-fixture";
import { LIVE_GAME_REQUEST, LIVE_GAME_RESPONSE, type LiveGameAction } from "../utils/live-game";

const state = vi.hoisted(() => ({ context: null as PageGameContext | null, label: "10m left" }));
vi.mock("../utils/page-game-context", async (original) => ({
  ...(await original<typeof import("../utils/page-game-context")>()),
  readPageGameContext: () => state.context,
}));

let fixture: ReturnType<typeof orderFixture>;
let target: EventTarget;
let serial = 0;
const orderJson = JSON.stringify({ name: "Farms", steps: [{ rank: "Settlement", goal: "farm", count: 4 }] });
const scope = JSON.stringify(["https://rpc", "123", "39", "1"]);

function request(
  action: LiveGameAction,
  currentScope = scope,
): Promise<{ snapshot: LiveGameSnapshot; error?: string }> {
  const id = String(++serial);
  return new Promise((resolve) => {
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail.id !== id) return;
      target.removeEventListener(LIVE_GAME_RESPONSE, listener);
      resolve((event as CustomEvent).detail);
    };
    target.addEventListener(LIVE_GAME_RESPONSE, listener);
    target.dispatchEvent(new CustomEvent(LIVE_GAME_REQUEST, { detail: { id, scope: currentScope, action } }));
  });
}

async function nextAction(json = orderJson): Promise<Extract<LiveGameAction, { kind: "run-build-order" }>> {
  const { snapshot } = await request({ kind: "snapshot", orderJson: json, realmId: 10 });
  expect(snapshot.buildOrderDiagnostic).toBeUndefined();
  expect(snapshot.buildOrder.next).toBeDefined();
  return {
    kind: "run-build-order",
    realmId: 10,
    orderJson: json,
    expected: snapshot.buildOrder.expected,
    direction: 0,
  };
}

beforeEach(async () => {
  vi.resetModules();
  fixture = orderFixture();
  state.context = fixture.context;
  state.label = "10m left";
  target = new EventTarget();
  Object.assign(target, {
    querySelector: (selector: string) =>
      selector === ".game-finished-pill" ? null : { firstElementChild: { textContent: state.label } },
  });
  vi.stubGlobal("document", target);
  fixture.context.systemCalls.create_building = vi.fn(
    async ({ building_category, directions }: { building_category: number; directions: number[] }) => {
      fixture.build(building_category, 11, directions[0] === 0 ? 10 : 11);
    },
  );
  fixture.context.systemCalls.upgrade_realm = vi.fn(async () => {
    fixture.rows.Structure[0].base.level++;
  });
  fixture.context.systemCalls.explorer_create = vi.fn(
    async ({ category, tier, amount }: { category: number; tier: number; amount: bigint }) => {
      fixture.army(["Knight", "Paladin", "Crossbowman"][category], `T${tier + 1}`, amount);
    },
  );
  const { installLiveGameBridge } = await import("../utils/live-game-bridge");
  installLiveGameBridge();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("one official action per click", () => {
  it("previews without submitting and builds exactly one missing building", async () => {
    const action = await nextAction();
    expect(fixture.context.systemCalls.create_building).not.toHaveBeenCalled();
    const result = await request(action);
    expect(result.error).toBeUndefined();
    expect(fixture.rows.Building).toHaveLength(1);
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledTimes(1);
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledWith(
      expect.objectContaining({ use_simple: false, building_category: farm }),
    );
    expect(result.snapshot.buildOrder.steps[0]).toMatchObject({ current: 1, target: 4 });
  });
  it("rejects a stale count or changed next action rather than repeating or substituting it", async () => {
    const action = await nextAction();
    fixture.build(farm);
    expect((await request(action)).error).toContain("changed");
    expect(fixture.context.systemCalls.create_building).not.toHaveBeenCalled();
  });
  it("holds the duplicate-click lock through transaction confirmation", async () => {
    let finish!: () => void;
    fixture.context.systemCalls.create_building = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => {
            fixture.build(farm);
            resolve(undefined);
          };
        }),
    );
    const action = await nextAction();
    const first = request(action);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect((await request(action)).error).toContain("still confirming");
    finish();
    expect((await first).error).toBeUndefined();
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledTimes(1);
  });
  it("revalidates the planned action when the queued signer actually executes", async () => {
    fixture.context.systemCalls.create_building = vi.fn(async ({ signer }: QueuedSigner) => {
      fixture.build(farm);
      await signer.execute([]);
    });
    expect((await request(await nextAction())).error).toContain("changed");
    expect(fixture.account.execute).not.toHaveBeenCalled();
  });
  it("rechecks the chosen plot when another building occupies it before signing", async () => {
    fixture.context.systemCalls.create_building = vi.fn(async ({ signer }: QueuedSigner) => {
      fixture.build(BuildingType.ResourceFish);
      await signer.execute([]);
    });
    expect((await request(await nextAction())).error).toContain("plot changed");
    expect(fixture.account.execute).not.toHaveBeenCalled();
  });
  it("stops on account, network, and timing changes before queued signing", async () => {
    for (const change of [
      () => {
        fixture.context.account.account.address = "0x2";
      },
      () => {
        fixture.context.network.provider.provider!.channel!.nodeUrl = "https://other-rpc";
      },
      () => {
        state.label = "Starts in 1s";
      },
    ]) {
      fixture.context.account.account.address = "0x1";
      fixture.context.network.provider.provider!.channel!.nodeUrl = "https://rpc";
      state.label = "10m left";
      fixture.context.systemCalls.create_building = vi.fn(async ({ signer }: QueuedSigner) => {
        change();
        await signer.execute([]);
      });
      expect((await request(await nextAction())).error).toMatch(/changed|Game Not Started/);
    }
    expect(fixture.account.execute).not.toHaveBeenCalled();
  });
  it("takes one upgrade without starting the following build", async () => {
    fixture.rows.UpgradeRecipe.forEach((recipe) => {
      recipe.costs = [{ resource_type: 3, amount: 1n }];
    });
    expect((await request(await nextAction())).error).toBeUndefined();
    expect(fixture.rows.Structure[0].base.level).toBe(2);
    expect(fixture.context.systemCalls.upgrade_realm).toHaveBeenCalledTimes(1);
    expect(fixture.context.systemCalls.create_building).not.toHaveBeenCalled();
  });
  it.each(["T1", "T2", "T3"])("deploys one full %s army using the correct contract category", async (tier) => {
    const goal = tier === "T1" ? "army" : `army${tier}`;
    const json = JSON.stringify({ name: "Army", steps: [{ rank: "Settlement", goal, count: 1 }] });
    const result = await request(await nextAction(json));
    expect(result.error).toBeUndefined();
    expect(fixture.context.systemCalls.explorer_create).toHaveBeenCalledTimes(1);
    const props = vi.mocked(fixture.context.systemCalls.explorer_create).mock.calls[0][0];
    expect(props).toMatchObject({ category: 2, tier: Number(tier.slice(1)) - 1, slot: 0 });
    expect(BigInt(props.amount as bigint)).toBeGreaterThan(BigInt(RESOURCE_PRECISION));
    expect(result.snapshot.buildOrder.steps[0].status).toBe("complete");
  });
  it("deploys beside a realm using native ethereal-layer spacing", async () => {
    fixture.rows.TileOccupancy[0].alt = true;
    fixture.rows.TileOpt.forEach((tile) => {
      tile.alt = true;
    });
    fixture.rows.TileOpt[1].col = 115;
    const json = JSON.stringify({ name: "Army", steps: [{ rank: "Settlement", goal: "army", count: 1 }] });
    const action = await nextAction(json);
    expect((await request(action)).error).toBeUndefined();
    expect(fixture.context.systemCalls.explorer_create).toHaveBeenCalledWith(
      expect.objectContaining({ spawn_direction: 0 }),
    );
  });
  it("rejects occupied and unknown spawn tiles without sending a deployment", async () => {
    const json = JSON.stringify({ name: "Army", steps: [{ rank: "Settlement", goal: "army", count: 1 }] });
    const action = await nextAction(json);
    fixture.rows.TileOccupancy.push({ game_id: 39, entity_id: 20, alt: false, col: 101, row: 100 });
    expect((await request(action)).error).toContain("spawn tile");
    fixture.rows.TileOpt.pop();
    expect((await request(action)).error).toContain("spawn tile");
    expect(fixture.context.systemCalls.explorer_create).not.toHaveBeenCalled();
  });
  it("reports a revert without advancing progress or resubmitting", async () => {
    fixture.context.systemCalls.create_building = vi.fn(async () => ({
      execution_status: "REVERTED",
      revert_reason: "Need resources",
    }));
    expect((await request(await nextAction())).error).toBe("Need resources");
    const { snapshot } = await request({ kind: "snapshot", orderJson, realmId: 10 });
    expect(snapshot.buildOrder.steps[0].current).toBe(0);
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledTimes(1);
  });
  it("holds an action whose transaction was sent but confirmation is unavailable", async () => {
    fixture.context.systemCalls.create_building = vi.fn(async () => ({ status: "PENDING", transaction_hash: "0x1" }));
    const action = await nextAction();
    expect((await request(action)).error).toContain("confirmation unavailable");
    expect((await request(action)).error).toContain("waiting for game facts");
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledTimes(1);
  });
  it("holds after delayed facts and never resubmits until the submitted result arrives", async () => {
    vi.useFakeTimers();
    fixture.context.systemCalls.create_building = vi.fn(async () => undefined);
    const action = await nextAction();
    const first = request(action);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await first).error).toContain("facts have not arrived");
    expect((await request(action)).error).toContain("waiting for game facts");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.context.systemCalls.create_building).toHaveBeenCalledTimes(1);
    fixture.build(farm);
    const { snapshot } = await request({ kind: "snapshot", orderJson, realmId: 10 });
    expect(snapshot.buildOrder.blocker).toBeUndefined();
    expect(snapshot.buildOrder.steps[0].current).toBe(1);
  });
});
