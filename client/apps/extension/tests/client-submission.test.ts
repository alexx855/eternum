import { describe, expect, it, vi } from "vitest";
import { submitClientAction } from "../utils/client-submission";
function provider() {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    gameId: 44,
    on: (event: string, listener: (payload: unknown) => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    emit: (event: string, payload: unknown) => listeners.get(event)?.(payload),
    listeners,
  };
}
describe("client submission confirmation", () => {
  it("returns confirmed receipts and cleans subscriptions", async () => {
    const client = provider();
    const receipt = { statusReceipt: "SUCCEEDED", transaction_hash: "0x1" };
    expect(await submitClientAction(client, async () => receipt)).toEqual(receipt);
    expect(client.listeners.size).toBe(0);
  });
  it("waits for pending completion and ignores other transactions", async () => {
    const client = provider();
    const action = submitClientAction(client, async () => ({ statusReceipt: "PENDING", transaction_hash: "0x1" }));
    await Promise.resolve();
    client.emit("transactionComplete", { details: { transaction_hash: "0x2" } });
    const receipt = { transaction_hash: "0x1", execution_status: "SUCCEEDED" };
    client.emit("transactionComplete", { details: receipt });
    expect(await action).toEqual(receipt);
    expect(client.listeners.size).toBe(0);
  });
  it("reports failures emitted before the pending receipt returns", async () => {
    const client = provider();
    await expect(
      submitClientAction(client, async () => {
        client.emit("transactionFailed", { transactionHash: "0x1", message: "Insufficient Wheat" });
        return { statusReceipt: "PENDING", transaction_hash: "0x1" };
      }),
    ).rejects.toThrow("Insufficient Wheat");
    expect(client.listeners.size).toBe(0);
  });
  it("fails closed if pending confirmation is unavailable", async () => {
    await expect(
      submitClientAction({ gameId: 44 }, async () => ({ statusReceipt: "PENDING", transaction_hash: "0x1" })),
    ).rejects.toThrow("confirmation unavailable");
  });
  it("bounds pending confirmation and cleans subscriptions", async () => {
    vi.useFakeTimers();
    try {
      const client = provider();
      const action = submitClientAction(client, async () => ({ statusReceipt: "PENDING", transaction_hash: "0x1" }));
      const assertion = expect(action).rejects.toThrow("still pending");
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(client.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
