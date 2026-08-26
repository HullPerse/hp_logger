import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/api/logger.api";
import { setSpanRegistry, SpanRegistry } from "@/core/span.core";

import { captureConsole } from "./test.transport";

// Module scope: the factory captures nothing, so it lives outside the test.
const capacityRecord = (name: string): Parameters<SpanRegistry["add"]>[0] => ({
  durationMs: 1,
  level: "debug",
  message: `${name} completed`,
  name,
  parentId: undefined,
  spanId: `s-${name}`,
  timestamp: "2026-08-26T00:00:00.000Z",
  traceId: "t-cap",
});

interface JsonEntry extends Record<string, unknown> {
  message?: string;
  level?: string;
}

const parseJsonLines = (outputs: string[]): JsonEntry[] =>
  outputs.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as JsonEntry);

const findMessage = (entries: JsonEntry[], fragment: string): JsonEntry | undefined =>
  entries.find((e) => (e.message ?? "").includes(fragment));

describe("span tree", () => {
  let registry: SpanRegistry;
  let restore: () => void;
  let outputs: string[];

  beforeEach(() => {
    registry = new SpanRegistry(200);
    setSpanRegistry(registry);
    ({ outputs, restore } = captureConsole());
  });

  afterEach(() => {
    restore();
    setSpanRegistry(null);
  });

  test("manual span end logs duration and records spanId/traceId", () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    const span = logger.span("query");
    span.end();

    const entries = parseJsonLines(outputs);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry?.message).toContain("query completed in");
    expect(entry?.spanId).toBe(span.spanId);
    expect(entry?.traceId).toBe(span.traceId);
    expect(entry?.parentId).toBeUndefined();
  });

  test("callback span propagates spanId to entries inside it", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    await logger.span("request", async () => {
      logger.info("inside span");
    });

    const entries = parseJsonLines(outputs);
    const infoEntry = entries.find((e) => e.message === "inside span");
    expect(infoEntry).toBeDefined();
    expect(infoEntry?.spanId).toBeDefined();
    expect(infoEntry?.traceId).toBeDefined();
  });

  test("nested spans inherit traceId and set parentId", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    let rootTraceId = "";
    let dbSpanId = "";
    let rootSpanId = "";
    await logger.span("request", async (requestSpan) => {
      rootTraceId = requestSpan.traceId;
      rootSpanId = requestSpan.spanId;
      await logger.span("database", async (dbSpan) => {
        dbSpanId = dbSpan.spanId;
        logger.info("querying");
        expect(dbSpan.traceId).toBe(requestSpan.traceId);
        expect(dbSpan.parentId).toBe(requestSpan.spanId);
      });
    });

    const records = registry.forTrace(rootTraceId);
    expect(records).toHaveLength(2);
    const dbRecord = records.find((r) => r.name === "database");
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.parentId).toBe(rootSpanId);
    expect(dbRecord?.spanId).toBe(dbSpanId);
    expect(dbRecord?.traceId).toBe(rootTraceId);
  });

  test("traceTree renders an ASCII tree for completed spans", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "pretty" } });
    await logger.span("request", async () => {
      await logger.span("database", async () => {
        logger.info("querying");
      });
    });

    logger.traceTree();
    const output = outputs.join("\n");
    expect(output).toContain("request");
    expect(output).toContain("database");
    expect(output).toContain("span=");
    expect(output).toContain("`--");
  });

  test("traceTree with no spans logs a notice", () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "pretty" } });
    logger.traceTree();
    expect(outputs.some((l) => l.includes("no spans recorded"))).toBe(true);
  });

  test("span end is idempotent", () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    const span = logger.span("task");
    span.end();
    span.end();
    expect(parseJsonLines(outputs)).toHaveLength(1);
  });

  test("callback span auto-ends on success", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    await logger.span("request", async () => {
      logger.info("working");
    });

    const entries = parseJsonLines(outputs);
    const completed = findMessage(entries, "request completed");
    expect(completed).toBeDefined();
    expect(completed?.spanId).toBeDefined();
  });

  test("callback span logs error and rethrows", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    await expect(
      logger.span("failing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const entries = parseJsonLines(outputs);
    const completed = findMessage(entries, "failing completed");
    expect(completed).toBeDefined();
    expect(completed?.level).toBe("error");
  });

  test("non-callback span returns a handle with ids", () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    const span = logger.span("task");
    expect(span.spanId).toMatch(/^s[0-9a-f]+$/u);
    expect(span.traceId).toMatch(/^t[0-9a-f]+$/u);
    expect(span.parentId).toBeUndefined();
    span.end();
  });

  test("root span creates a new traceId", () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    const span1 = logger.span("a");
    const span2 = logger.span("b");
    expect(span1.traceId).not.toBe(span2.traceId);
    span1.end();
    span2.end();
  });

  test("child span inside callback reuses parent traceId", async () => {
    const logger = createLogger({ settings: { colors: false, level: "debug", mode: "json" } });
    let childTraceId = "";
    await logger.span("root", async (rootSpan) => {
      const child = logger.span("child");
      childTraceId = child.traceId;
      expect(childTraceId).toBe(rootSpan.traceId);
      expect(child.parentId).toBe(rootSpan.spanId);
      child.end();
    });

    const records = registry.forTrace(childTraceId);
    expect(records).toHaveLength(2);
  });

  test("registry capacity evicts the oldest completed spans", () => {
    const small = new SpanRegistry(2);
    small.add(capacityRecord("first"));
    small.add(capacityRecord("second"));
    expect(small.forTrace("t-cap").map((r) => r.name)).toEqual(["first", "second"]);
    small.add(capacityRecord("third"));
    expect(small.forTrace("t-cap").map((r) => r.name)).toEqual(["second", "third"]);
  });
});
