import { defineContentScript } from "wxt/sandbox";
import { storage } from "wxt/storage";

export default defineContentScript({
  matches: ["*://*.realms.world/*"],
  async main() {
    console.log("[Eternum Extension] Content script loaded");

    const getGameConfig = () => {
      try {
        // ACTIVE_WORLD_NAME might be a raw string or JSON string.
        // In the game code: localStorage.getItem(ACTIVE_KEY)
        const activeWorldName = localStorage.getItem("ACTIVE_WORLD_NAME");
        const profilesRaw = localStorage.getItem("WORLD_PROFILES");

        if (activeWorldName && profilesRaw) {
          // If it was saved with JSON.stringify, it might have quotes.
          // But the game code seemed to just set string?
          // `localStorage.setItem(ACTIVE_KEY, name)`
          // `name` is string.

          const profiles = JSON.parse(profilesRaw);
          const activeProfile = profiles[activeWorldName];
          return activeProfile;
        }
      } catch (e) {
        console.error("[Eternum Extension] Failed to parse config", e);
      }
      return null;
    };

    const checkConfig = async () => {
      const config = getGameConfig();
      if (config) {
        console.log("[Eternum Extension] Found config, saving to extension storage.");
        await storage.setItem("local:gameConfig", config);
      } else {
        console.log("[Eternum Extension] No config found in localStorage.");
      }
    };

    // Check immediately
    await checkConfig();

    // Also listen for changes in localStorage?
    // window.addEventListener('storage', ...) only fires for changes in OTHER tabs.
    // So polling or hooking setItem is needed if we want dynamic updates without reload.
    // For now, reload is fine.
  },
});
