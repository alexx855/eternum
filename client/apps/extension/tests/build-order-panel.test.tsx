import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOrderJson, DEFAULT_BUILD_ORDER } from "../../../../packages/core/src/automation/build-order";
import { planBuildOrder } from "../utils/build-order";
import { BuildOrderPanel } from "../components/BuildOrderPanel";
import type { LiveGameSnapshot } from "../utils/live-game";

const storage = vi.hoisted(() => ({ json: "", loaded: true, error: undefined as string | undefined }));
vi.mock("../utils/build-order-store", () => ({ useBuildOrderStore: () => storage }));

beforeEach(() => {
  storage.json = buildOrderJson(DEFAULT_BUILD_ORDER);
  storage.error = undefined;
});

function render(snapshot: LiveGameSnapshot | null, busy = false) {
  return renderToStaticMarkup(
    <BuildOrderPanel snapshot={snapshot} realmId="10" busy={busy} onRealm={() => {}} onAction={() => {}} />,
  );
}

describe("official order controls", () => {
  it("offers official editing and import without the retired CRUD or troop selection", () => {
    const html = render(null);
    expect(html).toContain("https://play.realms.party/blitz/build-orders");
    expect(html).toContain("Paste JSON");
    expect(html).toContain("Use official default");
    expect(html).not.toContain("Edit Presets");
    expect(html).not.toContain("Preset troop type");
  });
  it("renders all ranks and cumulative targets, with one action button disabled while busy", () => {
    const order = DEFAULT_BUILD_ORDER;
    const buildOrder = planBuildOrder(order, {
      realmId: 10,
      realmName: "Home",
      realmLevel: 1,
      isBlitzActive: true,
      canAffordUpgrade: false,
      hasAvailableBuildingTile: true,
      built: () => 0,
      buildability: () => ({ canBuild: true, needsRoom: false }),
      population: 0,
      populationCapacity: 10,
      troop: null,
      army: { armies: [], maxArmies: 1, troopsOnHand: () => 0, fullArmy: () => 50 },
    });
    const snapshot = { buildOrder, realms: [{ id: 10, realmId: 123 }] } as LiveGameSnapshot;
    const html = render(snapshot, true);
    for (const rank of ["Settlement", "City", "Kingdom", "Empire"]) expect(html).toContain(rank);
    expect(html).toContain("0 / 2");
    expect(html).toContain("0 / 4");
    expect(html).toContain("Requires Kingdom");
    expect(html).toContain("Waiting for confirmation");
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
  });
  it("shows corrupt-storage recovery and hides a preview for a replaced order", () => {
    storage.error = "Saved order is invalid";
    expect(render(null)).toContain("Saved order is invalid");
    expect(render(null)).toContain("Use official default");
    const html = render({
      buildOrder: { orderJson: "old", realmId: 10 },
      realms: [{ id: 10, realmId: 123 }],
    } as LiveGameSnapshot);
    expect(html).not.toContain("Next action:");
  });
});
