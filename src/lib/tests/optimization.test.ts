import { describe, expect, test } from "bun:test";

import { DEFAULT_REDACT_KEYS } from "@/config/redaction.config";
import { mergeEntryContext } from "@/core/context.core";
import type { Logger } from "@/index.logger";
import { redact } from "@/redact/index.redact";
import type { LogEntry, LogLevel } from "@/types/logger";

import { captureLogger } from "./test.transport";

// Timestamps can straddle a millisecond boundary between two writes.
const stripTimestamp = (entry: LogEntry): Omit<LogEntry, "timestamp"> => {
  const { timestamp: _timestamp, ...rest } = entry;
  return rest;
};

const emitByLevel = (
  logger: Logger,
  level: LogLevel,
  message: string | (() => string),
  context: Record<string, string> | undefined,
): void => {
  if (level === "info") logger.info(message, context);
  else if (level === "debug") logger.debug(message, context);
  else if (level === "warn") logger.warn(message, context);
  else logger.error(message, context);
};

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

describe("entry plan selection", () => {
  test("feature-less loggers compile the fast builder, featured ones the full builder", () => {
    const { logger } = captureLogger({ mode: "json", redactKeys: null });
    expect(logger.entryPlan.name).toBe("buildEntryFast");

    // Filters force the full builder; clearing them recompiles back.
    logger.settings({ filters: [() => true] });
    expect(logger.entryPlan.name).toBe("buildEntry");
    logger.settings({ filters: [] });
    expect(logger.entryPlan.name).toBe("buildEntryFast");
  });

  test("both builders produce identical entries for the same input", () => {
    const fastSetup = captureLogger({ level: "debug", mode: "json", redactKeys: null });
    // An identity serializer forces the full builder while keeping output.
    const slowSetup = captureLogger({
      level: "debug",
      mode: "json",
      redactKeys: null,
      serializers: { keep: (value) => value },
    });
    expect(fastSetup.logger.entryPlan.name).toBe("buildEntryFast");
    expect(slowSetup.logger.entryPlan.name).toBe("buildEntry");

    const inputs: [LogLevel, string | (() => string), Record<string, string> | undefined][] = [
      ["info", "hello", undefined],
      ["debug", () => "lazy", { requestId: "r1" }],
      ["warn", "with context", { userId: "u7" }],
      ["error", "plain error", undefined],
    ];

    for (const [level, message, context] of inputs) {
      fastSetup.entries.length = 0;
      slowSetup.entries.length = 0;
      emitByLevel(fastSetup.logger, level, message, context);
      emitByLevel(slowSetup.logger, level, message, context);
      expect(stripTimestamp(slowSetup.entries[0] as LogEntry)).toEqual(
        stripTimestamp(fastSetup.entries[0] as LogEntry),
      );
    }
  });
});
