import { serializeLogValue } from "./error";

const ETERNUM_EXTENSION_LOG_PREFIX = "[Eternum Extension]";

export function scopedExtensionLogMessage(scope: string, message: string) {
  if (!message) return `${ETERNUM_EXTENSION_LOG_PREFIX}[${scope}]`;

  return `${ETERNUM_EXTENSION_LOG_PREFIX}[${scope}] ${message}`;
}

export function normalizeForwardedExtensionLogArgs(args: unknown[], fallbackScope: string) {
  const [firstArg, ...remainingArgs] = args;
  if (typeof firstArg !== "string") {
    return [scopedExtensionLogMessage(fallbackScope, ""), ...args.map(serializeLogValue)];
  }

  const serializedRemainingArgs = remainingArgs.map(serializeLogValue);
  if (firstArg.startsWith(ETERNUM_EXTENSION_LOG_PREFIX)) return [firstArg, ...serializedRemainingArgs];

  const message = firstArg.replace(/^\[Content\]\s*/, "");
  return [scopedExtensionLogMessage(fallbackScope, message), ...serializedRemainingArgs];
}
