import { browser } from "wxt/browser";
import { AUTOMATION_MESSAGE, isAutomationOwnershipRequest } from "./automation-ownership";
import { isExtensionClientUrl } from "./extension-client-url";

interface AutomationOwner {
  tabId: number;
  documentId: string;
  claims: number;
}

const STORAGE_KEY = "automationOwners";

export function installAutomationOwnership() {
  // Session storage survives worker suspension. Serial updates make simultaneous claims atomic.
  let updates: Promise<unknown> = Promise.resolve();
  const updateOwners = <T>(update: (owners: Record<string, AutomationOwner>) => T) => {
    const result = updates.then(async () => {
      const stored = await browser.storage.session.get(STORAGE_KEY);
      const owners: Record<string, AutomationOwner> =
        (stored[STORAGE_KEY] as Record<string, AutomationOwner> | undefined) ?? {};
      const value = update(owners);
      await browser.storage.session.set({ [STORAGE_KEY]: owners });
      return value;
    });
    updates = result.catch(() => {});
    return result;
  };

  browser.runtime.onMessage.addListener(
    (message: unknown, sender: { tab?: { id?: number; url?: string }; documentId?: string; url?: string }) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("type" in message) ||
        message.type !== AUTOMATION_MESSAGE ||
        !("request" in message)
      )
        return;
      const request = message.request;
      const tabId = sender.tab?.id;
      const documentId = sender.documentId;
      if (
        !isAutomationOwnershipRequest(request) ||
        typeof tabId !== "number" ||
        !documentId ||
        !isExtensionClientUrl(sender.url ?? sender.tab?.url)
      ) {
        return Promise.resolve({ error: "Automation sender unavailable" });
      }
      return updateOwners((owners) => {
        const owner = owners[request.scope];
        const ownsScope = owner?.tabId === tabId && owner.documentId === documentId;
        if (request.operation === "release") {
          if (ownsScope && --owner.claims === 0) delete owners[request.scope];
          return {};
        }
        if (owner && !ownsScope) {
          return {
            error: "Automation for this account and game is already running in another tab. Stop it there first.",
          };
        }
        owners[request.scope] = { tabId, documentId, claims: (owner?.claims ?? 0) + 1 };
        return {};
      }).catch(() => ({ error: "Automation ownership unavailable" }));
    },
  );

  const forgetTab = (tabId: number) => {
    void updateOwners((owners) => {
      for (const [scope, owner] of Object.entries(owners)) {
        if (owner.tabId === tabId) delete owners[scope];
      }
    }).catch((error) => console.warn("[Eternum Extension] Failed to release tab automation", error));
  };
  browser.tabs.onRemoved.addListener(forgetTab);
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") forgetTab(tabId);
  });
}
