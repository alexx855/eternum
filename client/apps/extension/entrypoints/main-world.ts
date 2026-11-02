import { defineUnlistedScript } from "wxt/sandbox";
import { installLiveGameBridge } from "../utils/live-game-bridge";
import { onCustomEvent } from "../utils/events";
import { normalizeForwardedExtensionLogArgs } from "../utils/logging";

export default defineUnlistedScript(() => {
  const page = window as typeof window & { __eternumExtensionMainWorldBootstrapped?: boolean };
  if (page.__eternumExtensionMainWorldBootstrapped) return;
  page.__eternumExtensionMainWorldBootstrapped = true;
  installLiveGameBridge();
  onCustomEvent<{ method: string; args: string[] }>("ETERNUM_CONTENT_LOG", ({ method, args }) => {
    if (method !== "log" && method !== "warn" && method !== "error" && method !== "info" && method !== "debug") return;
    console[method](...normalizeForwardedExtensionLogArgs(args, "content"));
  });
});
