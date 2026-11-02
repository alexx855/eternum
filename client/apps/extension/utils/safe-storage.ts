import { storage } from "wxt/storage";
import { scopedExtensionLogMessage } from "./logging";

let contextInvalidated = false;
const storageLogMessage = (message: string) => scopedExtensionLogMessage("storage", message);

function handleError(error: unknown): void {
  if (error instanceof Error && error.message.includes("Extension context invalidated")) {
    if (!contextInvalidated) {
      contextInvalidated = true;
      document.dispatchEvent(new CustomEvent("eternum-context-invalidated"));
      console.warn(storageLogMessage("Extension context invalidated — storage disabled until page refresh"));
    }
    return;
  }
  throw error;
}

export async function safeGetItem<T>(key: `local:${string}`): Promise<T | null> {
  if (contextInvalidated) return null;
  try {
    return await storage.getItem<T>(key);
  } catch (error) {
    handleError(error);
    return null;
  }
}

export async function safeSetItem<T>(key: `local:${string}`, value: T): Promise<boolean> {
  if (contextInvalidated) return false;
  try {
    await storage.setItem(key, value);
    return true;
  } catch (error) {
    handleError(error);
    return false;
  }
}
