import { browser } from "wxt/browser";
import { defineBackground } from "wxt/sandbox";

export default defineBackground(() => {
  // When the extension icon is clicked, send a message to the content script
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    try {
      await browser.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
    } catch (error) {
      // Content script not loaded on this page
      console.log("[Eternum Extension] Cannot toggle overlay - content script not loaded on this tab");
    }
  });
});

