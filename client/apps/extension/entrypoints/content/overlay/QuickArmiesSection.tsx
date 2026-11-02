import { useState } from "react";
import { Loader2, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShadowSelect } from "@/components/ui/select";
import { selectArmyTroop } from "../../../utils/army-troops";
import { getRealmName } from "../../../data/realm-names";
import { DIRECTION_OPTIONS } from "../../../utils/directions";
import type { LiveRealm } from "../../../utils/live-game";
import { DEFAULT_ARMY_UNITS } from "../../../utils/game-data";

interface QuickArmiesSectionProps {
  realms: LiveRealm[];
  busy: boolean;
  creating: boolean;
  onCreate: (count: number, direction: number) => Promise<void>;
}

export function QuickArmiesSection({ realms, busy, creating, onCreate }: QuickArmiesSectionProps) {
  const [count, setCount] = useState(String(DEFAULT_ARMY_UNITS));
  const [direction, setDirection] = useState(DIRECTION_OPTIONS[1]!.value);
  const quantity = Number(count);
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0;
  const ready = realms.filter((realm) => selectArmyTroop(realm.troopBalances, quantity));

  return (
    <section className="space-y-3 rounded-lg border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eternum-section-title mb-0">
          <Swords className="h-4 w-4" /> Quick Armies
        </h3>
        <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
          All {realms.length} realms
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        One army per realm. Automatically uses each realm’s available T1 troops.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">Spawn direction</span>
          <ShadowSelect
            ariaLabel="Spawn direction"
            value={direction}
            onValueChange={setDirection}
            options={DIRECTION_OPTIONS}
            disabled={busy}
            className="h-9"
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Troops per army
          <input
            type="number"
            min="1"
            step="1"
            value={count}
            disabled={busy}
            onChange={(event) => setCount(event.target.value)}
            aria-invalid={!validQuantity}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </label>
      </div>
      <div className="divide-y rounded-md border bg-background/40">
        {realms.map((realm) => {
          const troop = selectArmyTroop(realm.troopBalances, quantity);
          return (
            <div key={realm.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
              <span className="min-w-0 truncate text-foreground">{getRealmName(realm.realmId)}</span>
              <span className={troop ? "shrink-0 text-foreground" : "shrink-0 text-muted-foreground"}>
                {!validQuantity
                  ? "Enter a quantity"
                  : troop
                    ? `${quantity.toLocaleString()} ${troop.name} T1`
                    : "Insufficient T1 troops"}
              </span>
            </div>
          );
        })}
        {realms.length === 0 && <p className="p-3 text-xs text-muted-foreground">No owned realms are synchronized.</p>}
      </div>
      <Button
        className="w-full"
        disabled={busy || ready.length === 0}
        onClick={() => void onCreate(quantity, Number(direction))}
      >
        {creating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating armies…
          </>
        ) : (
          `Create Armies · ${ready.length} ${ready.length === 1 ? "realm" : "realms"}`
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Each spawn tile must be explored and unoccupied. Realms without enough troops are skipped.
      </p>
    </section>
  );
}
