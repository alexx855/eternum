import { useState } from "react";
import { REALM_LEVELS } from "@bibliothecadao/types";
import { Button } from "./ui/button";
import { ShadowSelect } from "./ui/select";
import { getRealmName } from "../data/realm-names";
import { useBuildOrderStore } from "../utils/build-order-store";
import { parseBuildOrder } from "../utils/build-order";
import { DIRECTION_OPTIONS } from "../utils/directions";
import type { LiveGameAction, LiveGameSnapshot } from "../utils/live-game";

interface BuildOrderPanelProps {
  snapshot: LiveGameSnapshot | null;
  realmId: string;
  busy: boolean;
  onRealm: (id: string) => void;
  onAction: (action: LiveGameAction) => void;
}

export function BuildOrderPanel({ snapshot, realmId, busy, onRealm, onAction }: BuildOrderPanelProps) {
  const order = useBuildOrderStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState<string>();
  const preview = snapshot?.buildOrder?.orderJson === order.json ? snapshot.buildOrder : undefined;
  const next = preview?.next;
  const spawnDirection =
    direction && preview?.spawnDirections.includes(Number(direction))
      ? direction
      : String(preview?.spawnDirections[0] ?? "");
  const realm = snapshot?.realms.find((realm) => String(realm.id) === realmId) ?? snapshot?.realms[0];
  const fresh = preview?.realmId === realm?.id;
  const disabled = busy || saving;

  async function save(useDefault = false) {
    if (disabled) return;
    setSaving(true);
    setError("");
    try {
      if (useDefault) await order.useDefault();
      else await order.replace(draft);
      setEditing(false);
      setDraft("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function runNext() {
    if (disabled || !fresh || !preview?.expected || !realm || preview.blocker || order.error) return;
    onAction({
      kind: "run-build-order",
      realmId: realm.id,
      orderJson: order.json,
      expected: preview.expected,
      direction: Number(spawnDirection || DIRECTION_OPTIONS[0].value),
    });
  }

  return (
    <section className="space-y-3 rounded-lg border bg-secondary/20 p-4" aria-label="Build order">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="eternum-section-title mb-0">Build Order · {parseBuildOrder(order.json).name}</h3>
        <a
          href="https://play.realms.party/blitz/build-orders"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          Official editor ↗
        </a>
      </div>
      <p className="text-xs text-muted-foreground">Follow an official order. Each click takes one game action.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(!editing)}>
          Paste JSON
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void save(true)}>
          Use official default
        </Button>
      </div>
      {editing && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Copy JSON in the official editor, then paste it here.</span>
            <textarea
              aria-label="Official build order JSON"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={disabled}
              rows={7}
              className="w-full rounded-md border bg-background p-3 font-mono text-xs text-foreground"
            />
          </label>
          <Button size="sm" type="submit" disabled={disabled || !draft.trim()}>
            Load order
          </Button>
        </form>
      )}
      {(error || order.error) && (
        <p role="alert" className="text-xs text-red-300">
          {error || order.error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Realm
        <select
          value={realm ? String(realm.id) : ""}
          disabled={disabled}
          onChange={(event) => onRealm(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          {snapshot?.realms.map((realm) => (
            <option key={realm.id} value={realm.id}>
              {getRealmName(realm.realmId)} · {realm.id}
            </option>
          ))}
        </select>
      </label>
      {snapshot?.buildOrderDiagnostic && (
        <p role="status" className="text-xs text-amber-200">
          {snapshot.buildOrderDiagnostic}
        </p>
      )}
      {fresh && preview && !order.error && (
        <>
          <div className="rounded-md border bg-background/40 p-3 space-y-2" aria-live="polite">
            <p className="text-sm">{next ? `Next action: ${next.label}` : (preview.blocker ?? "Order complete.")}</p>
            {next?.reason && <p className="text-xs text-muted-foreground">{next.reason}</p>}
            {preview.blocker && next && <p className="text-xs text-amber-200">{preview.blocker}</p>}
            {next?.action === "deploy-army" && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Spawn direction</span>
                <ShadowSelect
                  ariaLabel="Order army spawn direction"
                  value={spawnDirection}
                  onValueChange={setDirection}
                  disabled={disabled}
                  options={DIRECTION_OPTIONS.filter((option) => preview.spawnDirections.includes(Number(option.value)))}
                />
                <p className="text-xs text-muted-foreground">
                  {next.troops?.count.toLocaleString()} {next.troops?.type} {next.troops?.tier}
                </p>
              </div>
            )}
            <Button className="w-full" disabled={disabled || !next || Boolean(preview.blocker)} onClick={runNext}>
              {busy ? "Waiting for confirmation…" : (next?.label ?? "Waiting")}
            </Button>
          </div>
          <div className="space-y-3">
            {REALM_LEVELS.map((rank, index) => {
              const steps = preview.steps.filter((step) => step.rank === index);
              if (!steps.length) return null;
              return (
                <div key={rank} className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">{rank}</h4>
                  <ol className="divide-y rounded-md border bg-background/40">
                    {steps.map((step, stepIndex) => (
                      <li key={stepIndex} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span>{step.label}</span>
                          <span className={step.status === "complete" ? "text-emerald-300" : "text-muted-foreground"}>
                            {step.status === "skipped" ? "Not applicable" : `${step.current} / ${step.target}`}
                          </span>
                        </div>
                        {step.note && <p className="mt-1 text-muted-foreground">{step.note}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!preview && !snapshot?.buildOrderDiagnostic && (
        <p role="status" className="text-xs text-muted-foreground">
          Reading order progress…
        </p>
      )}
    </section>
  );
}
