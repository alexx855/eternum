import { browser } from "wxt/browser";
import { defineBackground } from "wxt/sandbox";
import {
  ACTIVATE_EXTENSION_MESSAGE,
  TOGGLE_OVERLAY_MESSAGE,
  type ExtensionTabMessage,
  isContentReadyMessage,
} from "../utils/extension-messages";
import { installAutomationOwnership } from "../utils/automation-ownership-background";
import { isExtensionClientUrl } from "../utils/extension-client-url";
import { scopedExtensionLogMessage } from "../utils/logging";

interface RuntimeMessageSender {
  tab?: {
    id?: number;
    url?: string;
  };
}

const CONTENT_SCRIPT_FILE = "content-scripts/content.js";
const ACTIVATION_RETRY_DELAYS_MS = [0, 75, 200];
const backgroundLogMessage = (message: string) => scopedExtensionLogMessage("background", message);

const waitBeforeRetry = async (delayMs: number) => {
  if (delayMs === 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const isMissingContentScriptError = (error: unknown) => {
  const message = getErrorMessage(error);
  return message.includes("Could not establish connection") || message.includes("Receiving end does not exist");
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export default defineBackground(() => {
  const activatedTabs = new Set<number>();
  installAutomationOwnership();

  const sendExtensionMessage = async (tabId: number, message: ExtensionTabMessage) => {
    await browser.tabs.sendMessage(tabId, message);
  };

  const sendToggleMessage = async (tabId: number) => {
    await sendExtensionMessage(tabId, { type: TOGGLE_OVERLAY_MESSAGE });
  };

  const sendToggleMessageIfContentScriptReady = async (tabId: number) => {
    try {
      await sendToggleMessage(tabId);
      return true;
    } catch (error) {
      if (isMissingContentScriptError(error)) return false;
      throw error;
    }
  };

  const injectExtensionContentScript = async (tabId: number) => {
    console.log(backgroundLogMessage("Content script missing; injecting before activation"));
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  };

  const retryToggleMessage = async (tabId: number) => {
    for (const retryDelayMs of ACTIVATION_RETRY_DELAYS_MS) {
      await waitBeforeRetry(retryDelayMs);

      if (await sendToggleMessageIfContentScriptReady(tabId)) return;
    }

    throw new Error("[Eternum Extension] Content script did not respond after fallback injection");
  };

  const toggleExtensionContent = async (tabId: number) => {
    if (await sendToggleMessageIfContentScriptReady(tabId)) return;

    await injectExtensionContentScript(tabId);
    await retryToggleMessage(tabId);
  };

  const handleActionClick = async (tabId: number, url: string | undefined) => {
    if (!isExtensionClientUrl(url)) return;
    // Fallback injection announces readiness; avoid restoring and toggling the same overlay twice.
    activatedTabs.delete(tabId);
    await toggleExtensionContent(tabId);
    activatedTabs.add(tabId);
  };

  browser.action.onClicked.addListener((tab) => {
    if (typeof tab.id !== "number") return;

    handleActionClick(tab.id, tab.url).catch((error: unknown) => {
      console.error(backgroundLogMessage("Extension action failed"), error);
    });
  });

  browser.runtime.onMessage.addListener((message: unknown, sender: RuntimeMessageSender) => {
    if (!isContentReadyMessage(message)) return;

    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return;

    // Restore only this tab after content-script reload; never focus another window.
    if (!activatedTabs.has(tabId)) return;
    sendExtensionMessage(tabId, { type: ACTIVATE_EXTENSION_MESSAGE }).catch((error: unknown) => {
      console.warn(backgroundLogMessage("Extension tab did not accept activation"), error);
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => activatedTabs.delete(tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === "string" && !isExtensionClientUrl(changeInfo.url)) activatedTabs.delete(tabId);
  });
});
