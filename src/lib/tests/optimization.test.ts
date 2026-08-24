import { describe, expect, test } from "bun:test";

import { DEFAULT_REDACT_KEYS } from "@/config/redaction.config";
import { mergeEntryContext } from "@/core/context.core";
import { redact } from "@/redact/index.redact";

describe("optimization contracts", () => {
  test("redaction keeps a flat context object when no key needs masking", () => {
    const context = { requestId: "req-1", service: "api" };

    expect(redact(context, DEFAULT_REDACT_KEYS)).toBe(context);
  });

  test("redaction copies a context only when a matching key needs masking", () => {
    const context = { password: "secret", requestId: "req-1" };
    const result = redact(context, DEFAULT_REDACT_KEYS);

    expect(result).not.toBe(context);
    expect(result).toEqual({ password: "[REDACTED]", requestId: "req-1" });
  });

  test("context merge returns existing objects on the no-copy paths", () => {
    const staticContext = { service: "api" };
    const lazyContext = { requestId: "req-1" };

    expect(mergeEntryContext(staticContext, true)).toBe(staticContext);
    expect(mergeEntryContext({}, false, lazyContext)).toBe(lazyContext);
  });

  test("context merge keeps entry, async, and static precedence", () => {
    expect(
      mergeEntryContext(
        { shared: "static", staticOnly: true },
        true,
        { entryOnly: true, shared: "entry" },
        { asyncOnly: true, shared: "async" },
      ),
    ).toEqual({
      asyncOnly: true,
      entryOnly: true,
      shared: "entry",
      staticOnly: true,
    });
  });
});
