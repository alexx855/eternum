import { REALM_LEVELS } from "@bibliothecadao/types";
import {
  buildOrderGoalName,
  buildOrderJson,
  buildOrderTarget,
  readBuildOrderText,
  type BuildOrder,
  type BuildOrderStep,
} from "../../../../packages/core/src/automation/build-order";
import {
  buildBlitzRealmSuggestions,
  type BlitzRealmSuggestionInput,
  type BlitzSuggestionDraft,
} from "../../../../packages/core/src/automation/blitz-suggestions";

export function parseBuildOrder(json: string): BuildOrder {
  const read = readBuildOrderText(json);
  if ("error" in read) throw new Error(read.error);
  return read.ok;
}

export interface BuildOrderProgress {
  rank: number;
  label: string;
  current: number;
  target: number;
  status: "complete" | "pending" | "locked" | "skipped";
  note?: string;
}

export interface BuildOrderPreview {
  realmId: number;
  orderJson: string;
  steps: BuildOrderProgress[];
  next?: BlitzSuggestionDraft;
  /** A stateless check of the proposed action and the facts that would make repeating it unsafe. */
  expected?: string;
  blocker?: string;
  spawnDirections: number[];
  useSimpleCost: boolean;
}

export function planBuildOrder(order: BuildOrder, input: BlitzRealmSuggestionInput): BuildOrderPreview {
  const steps = order.steps.map((step) => readStepProgress(step, input));
  const next = buildBlitzRealmSuggestions(input, order)[0];
  const orderJson = buildOrderJson(order);
  return {
    realmId: input.realmId,
    orderJson,
    steps,
    next,
    expected: next ? actionExpectation(orderJson, input, next) : undefined,
    blocker: next ? undefined : describeOrderBlocker(order, steps, input),
    spawnDirections: [],
    useSimpleCost: false,
  };
}

function readStepProgress(step: BuildOrderStep, input: BlitzRealmSuggestionInput): BuildOrderProgress {
  const progress = readTargetProgress(step, input);
  return step.rank > input.realmLevel
    ? { ...progress, status: "locked", note: `Requires ${REALM_LEVELS[step.rank]}` }
    : progress;
}

function readTargetProgress(step: BuildOrderStep, input: BlitzRealmSuggestionInput): BuildOrderProgress {
  const target = buildOrderTarget(step.goal);
  const troop = input.troop;
  const progress = { rank: step.rank, label: buildOrderGoalName(step.goal), target: step.count };
  if (target.kind === "levelUp") return countedProgress(progress, input.realmLevel > step.rank ? 1 : 0);
  if (target.kind === "building") return countedProgress(progress, input.built(target.building));
  if (!troop) return { ...progress, current: 0, status: "skipped", note: "This biome favors no troop." };
  if (target.kind === "barracks") return countedProgress(progress, input.built(troop.tiers[target.tier].building));
  const current = input.army.armies.filter((army) => army.type === troop.type && army.tier === target.tier).length;
  const row = countedProgress(progress, current);
  if (row.status === "complete") return row;
  const slotsFull = input.army.armies.length >= input.army.maxArmies;
  const full = input.army.fullArmy(target.tier);
  const ready = full > 0 && input.army.troopsOnHand(troop.tiers[target.tier].resource) >= full;
  const noBarracks = input.built(troop.tiers[target.tier].building) === 0;
  const note = slotsFull
    ? "Army slots full; later steps can continue."
    : ready
      ? "A full army is ready."
      : noBarracks
        ? "Needs its troop barracks before training can continue."
        : "Waiting for a full army; later steps can continue.";
  return { ...row, note };
}

function countedProgress(
  progress: Pick<BuildOrderProgress, "rank" | "label" | "target">,
  current: number,
): BuildOrderProgress {
  return { ...progress, current, status: current >= progress.target ? "complete" : "pending" };
}

function actionExpectation(json: string, input: BlitzRealmSuggestionInput, next: BlitzSuggestionDraft) {
  return JSON.stringify({
    json,
    realm: input.realmId,
    level: input.realmLevel,
    action: next.action,
    building: next.buildingTypeHint,
    built: next.buildingTypeHint === undefined ? undefined : input.built(next.buildingTypeHint),
    troops: next.troops,
    armies: next.action === "deploy-army" ? input.army.armies : undefined,
  });
}

function describeOrderBlocker(order: BuildOrder, steps: BuildOrderProgress[], input: BlitzRealmSuggestionInput) {
  for (const [index, progress] of steps.entries()) {
    if (progress.status === "complete" || progress.status === "skipped") continue;
    if (progress.status === "locked") return `Reach ${REALM_LEVELS[progress.rank]} to continue.`;
    const target = buildOrderTarget(order.steps[index].goal);
    if (target.kind === "levelUp") return "Need resources to level up.";
    if (target.kind === "army") {
      const barracks = input.troop?.tiers[target.tier].building;
      if (barracks === undefined || input.built(barracks) > 0 || input.army.armies.length >= input.army.maxArmies)
        continue;
      return input.buildability(barracks).reason ?? "Waiting to build the army's barracks.";
    }
    const building = target.kind === "building" ? target.building : input.troop?.tiers[target.tier].building;
    if (building === undefined) continue;
    const readiness = input.buildability(building);
    if (readiness.needsRoom) return "Need population room. A worker hut is not ready to build yet.";
    if (!input.hasAvailableBuildingTile) return "No free building plots. Upgrade the realm to continue.";
    return readiness.reason ?? "Waiting for building requirements.";
  }
  return steps.some((step) => step.status === "pending") ? "Waiting for troops or free army slots." : undefined;
}
