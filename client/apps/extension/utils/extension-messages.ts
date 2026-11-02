import { isRecord } from "./type-guards";

export const ACTIVATE_EXTENSION_MESSAGE = "ACTIVATE_EXTENSION";
export const CONTENT_READY_MESSAGE = "CONTENT_READY";
export const TOGGLE_OVERLAY_MESSAGE = "TOGGLE_OVERLAY";

export const ETERNUM_SHOW_OVERLAY_EVENT = "eternum-show-overlay";
export const ETERNUM_TOGGLE_OVERLAY_EVENT = "eternum-toggle-overlay";

interface ActivateExtensionMessage {
  type: typeof ACTIVATE_EXTENSION_MESSAGE;
}

interface ContentReadyMessage {
  type: typeof CONTENT_READY_MESSAGE;
}

interface ToggleOverlayMessage {
  type: typeof TOGGLE_OVERLAY_MESSAGE;
}

export type ExtensionTabMessage = ActivateExtensionMessage | ToggleOverlayMessage;

export function isActivateExtensionMessage(message: unknown): message is ActivateExtensionMessage {
  return isRecord(message) && message.type === ACTIVATE_EXTENSION_MESSAGE;
}

export function isContentReadyMessage(message: unknown): message is ContentReadyMessage {
  return isRecord(message) && message.type === CONTENT_READY_MESSAGE;
}

export function isToggleOverlayMessage(message: unknown): message is ToggleOverlayMessage {
  return isRecord(message) && message.type === TOGGLE_OVERLAY_MESSAGE;
}
