import { useEffect, useState } from "react";
import { RESOURCE_PRECISION } from "@bibliothecadao/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getRealmName } from "../../../data/realm-names";
import { DIRECTION_OPTIONS } from "../../../utils/directions";
import type { LiveArmy, LiveGameAction, LiveGameSnapshot } from "../../../utils/live-game";

interface ArmiesSectionProps {
  snapshot: LiveGameSnapshot;
  busy: boolean;
  onAction: (action: LiveGameAction) => Promise<void>;
}

export function LiveArmiesSection({ snapshot, busy, onAction }: ArmiesSectionProps) {
  const [explore, setExplore] = useState(true);
  const runningCount = snapshot.autoMoving.length;
  return (
    <section className="space-y-4 rounded-lg border bg-secondary/20 p-3" aria-label="Auto Move armies">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="eternum-section-title mb-1">Auto Move</h3>
          <p className="text-xs text-muted-foreground" role="status">
            {!snapshot.autoMoveEnabled
              ? "Paused · automatic moves stopped"
              : runningCount
                ? `${runningCount} ${runningCount === 1 ? "army" : "armies"} moving`
                : "Ready · choose armies below"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Master</span>
          <Switch
            aria-label="Enable Auto Move for all armies"
            checked={snapshot.autoMoveEnabled}
            disabled={busy && !snapshot.autoMoveEnabled}
            onCheckedChange={(enabled) => void onAction({ kind: "set-auto-move-enabled", enabled })}
            className="data-[state=checked]:bg-emerald-600"
          />
        </div>
      </div>
      <div className="space-y-2 border-y py-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            className="h-4 w-4 accent-[#d4af37]"
            type="checkbox"
            checked={explore}
            disabled={busy || runningCount > 0}
            onChange={(event) => setExplore(event.target.checked)}
          />
          Explore new tiles
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {explore ? "Explore an unexplored tile" : "Travel across an explored tile"} in each army’s direction every 5
          seconds. Turning Master off stops every army. Re-enable it, then start armies individually.
        </p>
      </div>
      {snapshot.realms.map((realm) => {
        const armies = snapshot.armies.filter((army) => army.home === realm.id);
        if (!armies.length) return null;
        return (
          <div key={realm.id} className="space-y-2">
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <h4 className="font-semibold">{getRealmName(realm.realmId)}</h4>
              <span>
                {armies.length} {armies.length === 1 ? "army" : "armies"}
              </span>
            </div>
            {armies.map((army) => (
              <LiveArmyRow
                key={army.id}
                army={army}
                running={snapshot.autoMoving.includes(army.id)}
                activeSetting={snapshot.autoMoveSettings[army.id]}
                masterEnabled={snapshot.autoMoveEnabled}
                explore={explore}
                busy={busy}
                onAction={onAction}
              />
            ))}
          </div>
        );
      })}
      {!snapshot.armies.length && (
        <p className="text-sm text-muted-foreground">No explorer armies synchronized. Create an army to get started.</p>
      )}
    </section>
  );
}

function LiveArmyRow({
  army,
  running,
  activeSetting,
  masterEnabled,
  explore,
  busy,
  onAction,
}: {
  army: LiveArmy;
  running: boolean;
  activeSetting?: { direction: number; explore: boolean };
  masterEnabled: boolean;
  explore: boolean;
  busy: boolean;
  onAction: ArmiesSectionProps["onAction"];
}) {
  const [selectedDirection, setDirection] = useState(
    activeSetting ? String(activeSetting.direction) : DIRECTION_OPTIONS[0]!.value,
  );
  const activeDirection = activeSetting?.direction;
  useEffect(() => {
    if (activeDirection !== undefined) setDirection(String(activeDirection));
  }, [activeDirection]);
  const direction = activeSetting ? String(activeSetting.direction) : selectedDirection;
  const exploreMode = activeSetting?.explore ?? explore;
  const readiness = army.readiness;
  const cost = readiness
    ? exploreMode
      ? readiness.exploreCost
      : (readiness.travelCosts[Number(direction)] ?? null)
    : null;
  const insufficient = readiness !== null && cost !== null && readiness.current < cost;
  const requirement = !readiness
    ? "Stamina unavailable"
    : cost === null
      ? "Travel cost unavailable · tile not synchronized"
      : `${exploreMode ? "Explore" : "Travel"} requires ${cost} stamina${insufficient ? ` · need ${cost - readiness.current} more` : ""}`;
  const move = (kind: "move" | "auto-move") =>
    void onAction({ kind, armyId: army.id, direction: Number(direction), explore: exploreMode });

  return (
    <div className="space-y-3 rounded-md border bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Army #{army.id}{" "}
            <span className="font-normal text-muted-foreground">
              · {army.category} {army.tier}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Intl.NumberFormat().format(Number(BigInt(army.count)) / RESOURCE_PRECISION)} troops
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${running ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "text-muted-foreground"}`}
        >
          {running ? "Moving" : insufficient ? "Low stamina" : "Stopped"}
        </span>
      </div>
      <div className="space-y-1.5" title={army.readinessError}>
        <div className="flex justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Stamina</span>
          <span className="tabular-nums">{readiness ? `${readiness.current} / ${readiness.max}` : "Unavailable"}</span>
        </div>
        {readiness && (
          <div
            role="progressbar"
            aria-label={`Stamina for army ${army.id}`}
            aria-valuenow={readiness.current}
            aria-valuemin={0}
            aria-valuemax={readiness.max}
            className="h-1.5 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={`h-full rounded-full ${insufficient ? "bg-amber-500" : "bg-emerald-500/70"}`}
              style={{ width: `${Math.max(0, Math.min(100, (readiness.current / readiness.max) * 100))}%` }}
            />
          </div>
        )}
        <p className={`text-xs ${insufficient ? "text-amber-300" : "text-muted-foreground"}`}>{requirement}</p>
        {!readiness && <p className="text-xs text-amber-300">{army.readinessError}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Direction
          <select
            aria-label={`Direction for army ${army.id}`}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            value={direction}
            disabled={busy || running}
            onChange={(event) => setDirection(event.target.value)}
          >
            {DIRECTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy || running || insufficient}
            onClick={() => move("move")}
            aria-label={`Move army ${army.id} once`}
          >
            Move Once
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs">Auto</span>
            <Switch
              aria-label={`Auto Move for army ${army.id}`}
              checked={running}
              disabled={!running && (busy || !masterEnabled || insufficient)}
              onCheckedChange={(enabled) =>
                enabled ? move("auto-move") : void onAction({ kind: "stop", armyId: army.id })
              }
              className="data-[state=checked]:bg-emerald-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
