import {
  AUTOMATION_REQUEST,
  AUTOMATION_RESPONSE,
  AUTOMATION_MESSAGE,
  isAutomationOwnershipRequest,
} from "../../utils/automation-ownership";
import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi, injectScript } from "wxt/client";
import { defineContentScript } from "wxt/sandbox";
import { LiveClientOverlay } from "./overlay/LiveClientOverlay";
import {
  CONTENT_READY_MESSAGE,
  ETERNUM_SHOW_OVERLAY_EVENT,
  ETERNUM_TOGGLE_OVERLAY_EVENT,
  isActivateExtensionMessage,
  isToggleOverlayMessage,
} from "../../utils/extension-messages";
import { serializeLogValue } from "../../utils/error";
import { scopedExtensionLogMessage } from "../../utils/logging";
import "@/assets/style.css";
import "./style.css";

const CONTENT_BOOTSTRAP_KEY = "__eternumExtensionContentBootstrapState";
const OVERLAY_HOST_SELECTOR = "eternum-extension-overlay[data-wxt-shadow-root]";
const contentLogMessage = (message: string) => scopedExtensionLogMessage("content", message);

type RuntimeMessageListener = (message: unknown) => Promise<void> | undefined;

interface ContentBootstrapState {
  bootstrapped?: boolean;
  messageListener?: RuntimeMessageListener;
}

const forwardLogs = () => {
  const methods = ["log", "warn", "error", "info", "debug"] as const;
  methods.forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const serializedArgs = args.map(serializeLogValue);
      original(...serializedArgs);
      document.dispatchEvent(
        new CustomEvent("ETERNUM_CONTENT_LOG", {
          detail: { method, args: serializedArgs },
        }),
      );
    };
  });
};

const stopEventsAtExtensionBoundary = (root: Node) => {
  if (!(root instanceof Document || root instanceof ShadowRoot)) return;

  const stopBoundaryEvent = (event: Event) => {
    event.stopPropagation();
  };

  root.addEventListener("keydown", stopBoundaryEvent);
  root.addEventListener("keyup", stopBoundaryEvent);
  root.addEventListener("keypress", stopBoundaryEvent);
  root.addEventListener("pointerdown", stopBoundaryEvent);
  root.addEventListener("pointerup", stopBoundaryEvent);
  root.addEventListener("click", stopBoundaryEvent);
};

const getContentBootstrapState = () =>
  globalThis as typeof globalThis & {
    [CONTENT_BOOTSTRAP_KEY]?: ContentBootstrapState;
  };

const getOrCreateContentBootstrapState = () => {
  const state = getContentBootstrapState();
  state[CONTENT_BOOTSTRAP_KEY] ??= {};
  return state[CONTENT_BOOTSTRAP_KEY];
};

const isActiveRuntimeMessageListener = (listener: RuntimeMessageListener | undefined) => {
  if (!listener) return false;

  try {
    return browser.runtime.onMessage.hasListener(listener);
  } catch {
    return false;
  }
};

const removeExistingOverlayHosts = () => {
  for (const host of document.querySelectorAll(OVERLAY_HOST_SELECTOR)) {
    host.remove();
  }
};

const notifyContentReady = async () => {
  await browser.runtime
    .sendMessage({ type: CONTENT_READY_MESSAGE })
    .catch(() => document.dispatchEvent(new CustomEvent("eternum-context-invalidated")));
};

// eslint-disable-next-line react-refresh/only-export-components
export default defineContentScript({
  matches: [
    "*://realms.world/*",
    "*://*.realms.world/*",
    "*://play.realms.party/*",
    "*://play.jcndata.com/*",
    "http://localhost/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*",
  ],
  cssInjectionMode: "ui",

  async main(ctx) {
    console.log(contentLogMessage("Content script loaded"));

    const bootstrapState = getOrCreateContentBootstrapState();
    if (isActiveRuntimeMessageListener(bootstrapState.messageListener)) {
      await notifyContentReady();
      return;
    }

    if (bootstrapState.bootstrapped) {
      console.warn(contentLogMessage("Content script reinjected; rebuilding activation listeners"));
    }

    bootstrapState.bootstrapped = true;

    let logsForwarded = false;
    let mainWorldInjected = false;
    let eventBridgeReady = false;
    let overlayMounted = false;
    let overlayMountPromise: Promise<boolean> | null = null;

    const setupLogForwarding = () => {
      if (logsForwarded) return;
      forwardLogs();
      logsForwarded = true;
    };

    const setupMainWorldBridge = () => {
      if (eventBridgeReady) return;
      document.addEventListener(AUTOMATION_REQUEST, (event) => {
        if (!(event instanceof CustomEvent) || !isAutomationOwnershipRequest(event.detail)) return;
        const request = event.detail;
        void browser.runtime.sendMessage({ type: AUTOMATION_MESSAGE, request }).then(
          (result) =>
            document.dispatchEvent(
              new CustomEvent(AUTOMATION_RESPONSE, { detail: { id: request.id, ...(result as { error?: string }) } }),
            ),
          () =>
            document.dispatchEvent(
              new CustomEvent(AUTOMATION_RESPONSE, {
                detail: { id: request.id, error: "Automation ownership unavailable. Refresh this tab." },
              }),
            ),
        );
      });

      eventBridgeReady = true;
    };

    const injectMainWorld = async () => {
      if (mainWorldInjected) return;

      await injectScript("/main-world.js", {
        keepInDom: true,
      });

      console.log(contentLogMessage("Main world script injected"));
      mainWorldInjected = true;
    };

    const mountOverlay = async (initialVisible = false) => {
      if (overlayMounted) return true;

      setupLogForwarding();
      setupMainWorldBridge();
      await injectMainWorld();
      removeExistingOverlayHosts();

      const ui = await createShadowRootUi(ctx, {
        name: "eternum-extension-overlay",
        position: "inline",
        anchor: "body",
        append: "last",
        onMount: (container) => {
          const wrapper = document.createElement("div");
          wrapper.id = "eternum-extension-root";
          wrapper.className = "dark";
          container.appendChild(wrapper);
          stopEventsAtExtensionBoundary(wrapper.getRootNode());
          const root = ReactDOM.createRoot(wrapper);
          const renderOverlay = () => root.render(<LiveClientOverlay initialVisible={initialVisible} />);
          renderOverlay();
          // WXT observes pushState/replaceState as well as Back/Forward navigation.
          ctx.addEventListener(window, "wxt:locationchange", renderOverlay);
          return root;
        },
        onRemove: (root) => {
          root?.unmount();
        },
      });

      ui.mount();
      overlayMounted = true;
      return false;
    };

    const ensureOverlayMounted = async (initialVisible = false) => {
      if (overlayMounted) return true;

      if (!overlayMountPromise) {
        overlayMountPromise = mountOverlay(initialVisible);
      }

      try {
        return await overlayMountPromise;
      } finally {
        overlayMountPromise = null;
      }
    };

    const activateExtension = async () => {
      await ensureOverlayMounted(true);
      document.dispatchEvent(new CustomEvent(ETERNUM_SHOW_OVERLAY_EVENT));
    };

    const toggleExtension = async () => {
      await ensureOverlayMounted();
      document.dispatchEvent(new CustomEvent(ETERNUM_TOGGLE_OVERLAY_EVENT));
    };

    try {
      const messageListener: RuntimeMessageListener = (message: unknown) => {
        if (isActivateExtensionMessage(message)) {
          return activateExtension();
        }

        if (isToggleOverlayMessage(message)) {
          return toggleExtension();
        }
      };

      browser.runtime.onMessage.addListener(messageListener);
      bootstrapState.messageListener = messageListener;
    } catch {
      console.warn(contentLogMessage("Extension context invalidated — icon toggle disabled until page refresh"));
    }

    await notifyContentReady();

    ensureOverlayMounted().catch((error: unknown) => {
      console.warn(contentLogMessage("Initial hidden overlay mount failed; activation will retry on click"), error);
    });
  },
});
