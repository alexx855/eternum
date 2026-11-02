import { useEffect, useState } from "react";
import { QuickArmiesSection } from "./QuickArmiesSection";
import { ShadowDialog } from "@/components/ui/shadow-dialog";
import { BuildOrderPanel } from "../../../components/BuildOrderPanel";
import { useBuildOrderStore } from "../../../utils/build-order-store";
import { getRealmName } from "../../../data/realm-names";
import { useGameStatus } from "../../../hooks/useGameStatus";
import { GAME_ACTION_BLOCK_MESSAGES } from "../../../utils/game-status";
import { ETERNUM_SHOW_OVERLAY_EVENT, ETERNUM_TOGGLE_OVERLAY_EVENT } from "../../../utils/extension-messages";
import { onCustomEvent } from "../../../utils/events";
import {
  LIVE_GAME_RESPONSE,
  createAllRealmArmies,
  requestLiveGame,
  type LiveGameAction,
  type LiveGameSnapshot,
} from "../../../utils/live-game";
import { LiveArmiesSection } from "./LiveArmiesSection";

export function LiveClientOverlay({ initialVisible }: { initialVisible: boolean }) {
  const [visible, setVisible] = useState(initialVisible);
  const [snapshot, setSnapshot] = useState<LiveGameSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [requestPending, setBusy] = useState(false);
  const [creatingArmies, setCreatingArmies] = useState(false);
  const [realmId, setRealmId] = useState("");
  const gameStatus = useGameStatus();
  const order = useBuildOrderStore();

  const loadOrder = order.load;
  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);
  useEffect(() => {
    const show = onCustomEvent(ETERNUM_SHOW_OVERLAY_EVENT, () => setVisible(true));
    const toggle = onCustomEvent(ETERNUM_TOGGLE_OVERLAY_EVENT, () => setVisible((value) => !value));
    const autoError = onCustomEvent<{ id: string; error?: string }>(LIVE_GAME_RESPONSE, (detail) => {
      if (detail.id === "auto-move" && detail.error) setError(`Auto Move stopped: ${detail.error}`);
    });
    return () => {
      show();
      toggle();
      autoError();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      requestLiveGame({
        kind: "snapshot",
        orderJson: order.loaded && !order.error ? order.json : undefined,
        realmId: realmId ? Number(realmId) : undefined,
      })
        .then(
          (next) => {
            if (active) setSnapshot(next);
          },
          (failure) => {
            if (active) {
              setSnapshot(null);
              setError(failure.message);
            }
          },
        )
        .finally(() => {
          if (active) timer = setTimeout(refresh, 3_000);
        });
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visible, gameStatus, order.loaded, order.error, order.json, realmId]);

  const actionError = error || snapshot?.action?.error;
  const busy = requestPending || snapshot?.action?.status === "running";
  // The observed clock wins immediately, even while the page bridge is still responding.
  const blocker = gameStatus === "live" ? (snapshot?.blocker ?? (snapshot ? null : "config-unavailable")) : gameStatus;
  const message = blocker ? GAME_ACTION_BLOCK_MESSAGES[blocker] : null;

  async function run(action: LiveGameAction) {
    const waitsForConfirmation = action.kind !== "stop" && action.kind !== "set-auto-move-enabled";
    if (waitsForConfirmation) setBusy(true);
    setError("");
    setStatus("");
    try {
      setSnapshot(await requestLiveGame(action, snapshot?.scope));
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : String(failure);
      setError(error);
    } finally {
      if (waitsForConfirmation) setBusy(false);
    }
  }

  async function createArmies(count: number, spawnDirection: number) {
    if (!snapshot) return;
    setBusy(true);
    setCreatingArmies(true);
    setError("");
    try {
      const result = await createAllRealmArmies(snapshot, count, spawnDirection, (item, index, total) => {
        setStatus(`Creating army ${index} of ${total} · ${getRealmName(item.realmId)}…`);
      });
      setStatus(
        `Created ${result.created} of ${result.total} armies. ${result.skipped} realms skipped for insufficient troops.`,
      );
      setError(
        result.failures.map(({ realm: item, message }) => `${getRealmName(item.realmId)}: ${message}`).join("\n"),
      );
      setSnapshot(
        await requestLiveGame({
          kind: "snapshot",
          orderJson: order.loaded && !order.error ? order.json : undefined,
          realmId: realmId ? Number(realmId) : undefined,
        }),
      );
    } catch (failure) {
      setSnapshot(null);
      setError((previous) =>
        [previous, failure instanceof Error ? failure.message : String(failure)].filter(Boolean).join("\n"),
      );
    } finally {
      setCreatingArmies(false);
      setBusy(false);
    }
  }

  return (
    <>
      <ShadowDialog open={visible} onClose={() => setVisible(false)} title="Eternum Extension" contentClassName="p-4">
        {actionError && (
          <p
            role="alert"
            className="whitespace-pre-line rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300"
          >
            {actionError}
          </p>
        )}
        {status && (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        )}
        {message ? (
          <section className="rounded-lg border bg-secondary/20 p-6 text-center">
            <h3 className="eternum-section-title justify-center">{message.title}</h3>
            <p className="text-sm text-muted-foreground">{message.message}</p>
            {blocker === "config-unavailable" && snapshot?.diagnostic && (
              <p className="mt-2 text-xs text-muted-foreground">{snapshot.diagnostic}</p>
            )}
          </section>
        ) : (
          <div className="space-y-5">
            <QuickArmiesSection
              realms={snapshot?.realms ?? []}
              busy={busy}
              creating={creatingArmies}
              onCreate={createArmies}
            />
            <BuildOrderPanel
              snapshot={snapshot}
              realmId={realmId}
              busy={busy}
              onRealm={setRealmId}
              onAction={(action) => void run(action)}
            />
            {snapshot && <LiveArmiesSection key={snapshot.scope} snapshot={snapshot} busy={busy} onAction={run} />}
            {busy && (
              <p role="status" className="text-center text-xs text-muted-foreground">
                Waiting for game confirmation…
              </p>
            )}
          </div>
        )}
      </ShadowDialog>
    </>
  );
}
