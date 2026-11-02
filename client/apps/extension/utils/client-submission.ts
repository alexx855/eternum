import { isRecord } from "./type-guards";
import type { PageProvider } from "./page-game-context";

export class ClientConfirmationUnavailableError extends Error {}

/** The client returns PENDING while its existing receipt watcher continues. */
export async function submitClientAction(provider: PageProvider, call: () => Promise<unknown>) {
  const outcomes = new Map<string, { receipt: unknown } | { error: Error }>();
  let notify = () => {};
  const complete = (payload: unknown) => {
    if (!isRecord(payload) || !isRecord(payload.details)) return;
    const hash = payload.details.transaction_hash;
    if (typeof hash === "string") outcomes.set(hash, { receipt: payload.details });
    notify();
  };
  const failed = (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.transactionHash !== "string") return;
    outcomes.set(payload.transactionHash, { error: new Error(String(payload.message ?? "Game action reverted")) });
    notify();
  };
  const observable = Boolean(provider.on && provider.off);
  if (observable) {
    provider.on!("transactionComplete", complete);
    provider.on!("transactionFailed", failed);
  }
  try {
    const receipt = await call();
    if (!isRecord(receipt)) return receipt;
    const status = receipt.execution_status ?? receipt.statusReceipt ?? receipt.status;
    if (status === "REVERTED" || status === "REJECTED")
      throw new Error(String(receipt.revert_reason ?? "Game action reverted"));
    if (status !== "PENDING") return receipt;
    const hash = receipt.transaction_hash;
    if (!observable || typeof hash !== "string")
      throw new ClientConfirmationUnavailableError(
        "Transaction submitted but confirmation unavailable. Refresh before continuing.",
      );
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new ClientConfirmationUnavailableError("Transaction is still pending. Refresh before continuing.")),
        30_000,
      );
      notify = () => {
        const outcome = outcomes.get(hash);
        if (!outcome) return;
        clearTimeout(timer);
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.receipt);
      };
      notify();
    });
  } finally {
    if (observable) {
      provider.off!("transactionComplete", complete);
      provider.off!("transactionFailed", failed);
    }
  }
}
