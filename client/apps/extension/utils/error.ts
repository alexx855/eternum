/**
 * Error serialization utilities
 */

/**
 * Serialize an unknown error to a string for messaging/logging
 */
export function serializeError(error: unknown): string {
  return serializeLogValue(error);
}

/**
 * Serialize an unknown console/log value without allowing objects to collapse to [object Object].
 */
export function serializeLogValue(value: unknown): string {
  if (!shouldSerializeAsJson(value)) return stringifyValue(value);

  const json = serializeAsJson(value);
  if (json) return json;

  return stringifyValue(value);
}

function shouldSerializeAsJson(value: unknown) {
  return isObjectLike(value);
}

function serializeAsJson(value: unknown) {
  try {
    const normalizedValue = normalizeSerializableValue(value, new WeakSet<object>());
    const serializedValue = JSON.stringify(normalizedValue);
    return serializedValue ?? null;
  } catch {
    return null;
  }
}

function normalizeSerializableValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (!isObjectLike(value)) return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);

  try {
    return normalizeTrackedObject(value, seen);
  } finally {
    seen.delete(value);
  }
}

function normalizeTrackedObject(value: object, seen: WeakSet<object>) {
  if (value instanceof Error) return normalizeError(value, seen);
  if (Array.isArray(value)) return value.map((item) => normalizeSerializableValue(item, seen));

  return normalizeObject(value, seen);
}

function normalizeError(error: Error, seen: WeakSet<object>) {
  return normalizeObject(error, seen, {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: normalizeErrorCause(error, seen),
  });
}

function normalizeErrorCause(error: Error, seen: WeakSet<object>) {
  if (!("cause" in error)) return undefined;

  return normalizeSerializableValue(error.cause, seen);
}

function normalizeObject(value: object, seen: WeakSet<object>, base: Record<string, unknown> = {}) {
  const result = { ...base };

  for (const key of Object.keys(value)) {
    result[key] = normalizeSerializableValue((value as Record<string, unknown>)[key], seen);
  }

  return result;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stringifyValue(value: unknown) {
  try {
    return String(value);
  } catch {
    return "[Unserializable]";
  }
}
