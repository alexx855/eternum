// @vitest-environment node

import { describe, expect, it } from "vitest";

import { serializeError, serializeLogValue } from "../utils/error";

describe("extension error serialization", () => {
  it("serializes plain object payloads as JSON", () => {
    expect(serializeLogValue({ code: "sync_failed", details: { armyId: 42 } })).toBe(
      '{"code":"sync_failed","details":{"armyId":42}}',
    );
  });

  it("includes error name and message", () => {
    const serializedError = JSON.parse(serializeError(new TypeError("Bad snapshot")));

    expect(serializedError).toMatchObject({
      name: "TypeError",
      message: "Bad snapshot",
    });
  });

  it("preserves nested error causes", () => {
    const innerError = new Error("Torii unavailable");
    const outerError = new Error("Snapshot sync failed") as Error & { cause?: unknown };
    outerError.cause = innerError;

    const serializedError = JSON.parse(serializeError(outerError));

    expect(serializedError).toMatchObject({
      name: "Error",
      message: "Snapshot sync failed",
      cause: {
        name: "Error",
        message: "Torii unavailable",
      },
    });
  });

  it("serializes circular references without throwing", () => {
    const payload: { label: string; self?: unknown } = { label: "circular" };
    payload.self = payload;

    expect(() => serializeLogValue(payload)).not.toThrow();
    expect(JSON.parse(serializeLogValue(payload))).toEqual({
      label: "circular",
      self: "[Circular]",
    });
  });

  it("serializes bigint values without throwing", () => {
    const payload = { amount: BigInt("100") };

    expect(() => serializeLogValue(payload)).not.toThrow();
    expect(serializeLogValue(payload)).toBe('{"amount":"100"}');
  });
});
