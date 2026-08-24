import { describe, expect, test } from "bun:test";

import { redact } from "@/redact/index.redact";

describe("redact", () => {
  test("returns primitive values unchanged when no secret expression is configured", () => {
    expect(redact("plain", null)).toBe("plain");
    expect(redact(42, /secret/iu)).toBe(42);
    expect(redact(null, /secret/iu)).toBeNull();
  });

  test("redacts bearer and key-value secrets in messages", () => {
    expect(redact("Bearer abc password=hunter2 token=xyz", /token/iu)).toBe(
      "Bearer [REDACTED] password=[REDACTED] token=[REDACTED]",
    );
  });

  test("redacts matching object keys and preserves unrelated values", () => {
    const value = { apiKey: "secret", nested: { token: "value" }, requestId: "req-1" };
    expect(redact(value, /apiKey/iu)).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "value" },
      requestId: "req-1",
    });
  });

  test("uses the configured depth boundary for nested values", () => {
    expect(redact({ one: { two: { three: "secret" } } }, /secret/iu, 1)).toEqual({
      one: { two: "[REDACTED]" },
    });
  });

  test("serializes errors and nested causes without losing the stable fields", () => {
    const cause = new Error("root cause");
    const error = new Error("request failed", { cause });
    expect(redact(error, /secret/iu)).toMatchObject({
      cause: {
        message: "root cause",
        name: "Error",
      },
      message: "request failed",
      name: "Error",
      stack: expect.stringContaining("request failed"),
    });
  });

  test("summarizes arrays instead of serializing every item", () => {
    expect(redact(["secret", "value"], /secret/iu)).toBe("[2 items]");
  });

  test("resets stateful custom expressions between calls", () => {
    const expression = /apiKey/giu;
    expect(redact({ apiKey: "one" }, expression)).toEqual({ apiKey: "[REDACTED]" });
    expect(redact({ apiKey: "two" }, expression)).toEqual({ apiKey: "[REDACTED]" });
  });
});
