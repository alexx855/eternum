export const AUTOMATION_REQUEST = "ETERNUM_AUTOMATION_OWNERSHIP_REQUEST";
export const AUTOMATION_RESPONSE = "ETERNUM_AUTOMATION_OWNERSHIP_RESPONSE";
export const AUTOMATION_MESSAGE = "AUTOMATION_OWNERSHIP";

export interface AutomationOwnershipRequest {
  id: string;
  scope: string;
  operation: "claim" | "release";
}

export function isAutomationOwnershipRequest(value: unknown): value is AutomationOwnershipRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as AutomationOwnershipRequest;
  return (
    typeof request.id === "string" &&
    typeof request.scope === "string" &&
    request.scope.length > 0 &&
    request.scope.length <= 2048 &&
    (request.operation === "claim" || request.operation === "release")
  );
}

function requestOwnership(scope: string, operation: "claim" | "release"): Promise<void> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timeout);
      document.removeEventListener(AUTOMATION_RESPONSE, onResponse);
      if (error) reject(new Error(error));
      else resolve();
    };
    const onResponse = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.id !== id) return;
      finish(event.detail.error);
    };
    const timeout = setTimeout(() => finish("Automation ownership unavailable. Refresh this tab."), 5000);
    document.addEventListener(AUTOMATION_RESPONSE, onResponse);
    document.dispatchEvent(new CustomEvent(AUTOMATION_REQUEST, { detail: { id, scope, operation } }));
  });
}

/** Retain ownership through idle intervals and pending confirmations, not just one tick. */
export async function retainAutomationOwnership(scope: string): Promise<() => Promise<void>> {
  await requestOwnership(scope, "claim");
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await requestOwnership(scope, "release");
  };
}

export function buildAutomationScope(network: string, world: string, game: string | number, account: string) {
  return JSON.stringify([
    network.replace(/\/$/, ""),
    BigInt(world).toString(16),
    String(game),
    BigInt(account).toString(16),
  ]);
}
