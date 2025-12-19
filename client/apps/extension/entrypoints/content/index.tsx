import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi, injectScript } from "wxt/client";
import { defineContentScript } from "wxt/sandbox";
import { storage } from "wxt/storage";
import { ExtensionOverlay } from "./overlay/ExtensionOverlay";
import "./style.css";

const matches = ["*://*.realms.world/*", "https://localhost/*"];

interface ControllerState {
  address: string | null;
  username: string | null;
  connected: boolean;
}

// Global controller state that will be updated from main world events
let controllerState: ControllerState = {
  address: null,
  username: null,
  connected: false,
};

export default defineContentScript({
  matches,
  cssInjectionMode: "ui",

  async main(ctx) {
    console.log("[Eternum Extension] Content script loaded");

    // Inject the main-world script to access window.starknet_controller
    try {
      await injectScript("/main-world.js", {
        keepInDom: true,
      });
      console.log("[Eternum Extension] Main world script injected");
    } catch (e) {
      console.error("[Eternum Extension] Failed to inject main world script:", e);
    }

    // Listen for controller state updates from main world
    document.addEventListener("ETERNUM_CONTROLLER_STATE", ((event: CustomEvent<ControllerState>) => {
      controllerState = event.detail;
      console.log("[Eternum Extension] Controller state updated:", controllerState);
      // Dispatch custom event to notify React component
      document.dispatchEvent(new CustomEvent("eternum-controller-state-changed", { detail: controllerState }));
    }) as EventListener);

    // Load game config from localStorage
    const getGameConfig = () => {
      try {
        const activeWorldName = localStorage.getItem("ACTIVE_WORLD_NAME");
        const profilesRaw = localStorage.getItem("WORLD_PROFILES");

        if (activeWorldName && profilesRaw) {
          const profiles = JSON.parse(profilesRaw);
          const activeProfile = profiles[activeWorldName];
          return activeProfile;
        }
      } catch (e) {
        console.error("[Eternum Extension] Failed to parse config", e);
      }
      return null;
    };

    const config = getGameConfig();
    if (config) {
      console.log("[Eternum Extension] Found config, saving to extension storage.");
      await storage.setItem("local:gameConfig", config);
    } else {
      console.log("[Eternum Extension] No config found in localStorage.");
    }

    // Create the Shadow DOM UI
    const ui = await createShadowRootUi(ctx, {
      name: "eternum-extension-overlay",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (container) => {
        // Create a dedicated wrapper element to avoid React warning about using body-like containers
        const wrapper = document.createElement("div");
        wrapper.id = "eternum-extension-root";
        container.appendChild(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(<ExtensionOverlay config={config} initialControllerState={controllerState} />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();

    // Listen for messages from the extension popup/background to toggle visibility
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type?: string };
      if (msg.type === "TOGGLE_OVERLAY") {
        const event = new CustomEvent("eternum-toggle-overlay");
        document.dispatchEvent(event);
      }
    });
  },
});
