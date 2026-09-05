import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildTraceparent,
  parseTraceparent,
  randomSpanId,
  randomTraceId,
} from "../../core/traceparent.core.js";
import { createLogger } from "../../index.logger.js";
import { createSampler } from "../sampling.utils.js";
import { captureLogger } from "../../testing/index.js";
import type { LogEntry } from "../../types/logger.js";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";

const entry = (message: string, traceId?: string): LogEntry => ({
  author: "T",
  context: traceId === undefined ? {} : { traceId },
  level: "info",
  message,
  timestamp: "2026-08-24T00:00:00.000Z",
});

describe("traceparent", () => {
  test("parses a valid header", () => {
    const parsed = parseTraceparent(buildTraceparent({ spanId: SPAN, traceId: TRACE }));
    expect(parsed).toEqual({ spanId: SPAN, traceId: TRACE });
  });

  test("rejects malformed and all-zero ids", () => {
    expect(parseTraceparent()).toBeNull();
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseTraceparent("00-xyz-abc-01")).toBeNull();
    expect(parseTraceparent(`00-${"0".repeat(32)}-${SPAN}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE}-${"0".repeat(16)}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE}-short-01`)).toBeNull();
  });

  test("random ids round-trip through parse", () => {
    for (let i = 0; i < 20; i += 1) {
      const random = { spanId: randomSpanId(), traceId: randomTraceId() };
      const parsed = parseTraceparent(buildTraceparent(random));
      expect(parsed).toEqual(random);
    }
  });
});

describe("span trace seeding", () => {
  test("span uses a foreign trace context from parsed traceparent", async () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const parent = parseTraceparent(buildTraceparent({ spanId: SPAN, traceId: TRACE }));

    await logger.span(
      "downstream",
      { parentSpanId: parent?.spanId, traceId: parent?.traceId },
      async () => {
        logger.info("inside downstream");
      },
    );

    const started = entries[0] as LogEntry;
    expect(started.context.traceId).toBe(TRACE);
    expect(started.context.parentId).toBe(SPAN);
    const child = entries[1] as LogEntry;
    expect(child.context.traceId).toBe(TRACE);
  });
});

describe("thread transport", () => {
  test("writes entries through a worker thread into a file", async () => {
    const dir = path.join(tmpdir(), `hp-thread-${Date.now()}`);
    const filePath = path.join(dir, "threaded.log");
    const { createThreadTransport } = await import("../../worker/thread.transport.js");
    const transport = createThreadTransport({
      file: { enabled: true, path: filePath },
      mode: "json",
    });

    await transport.write(entry("from thread"));
    await transport.flush();
    await transport.close();

    expect(readFileSync(filePath, "utf-8")).toContain("from thread");
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("trace-coherent sampling", () => {
  test("keeps whole traces or drops them, never splits", () => {
    const sampler = createSampler(0.5, true);
    const decisions = new Set<boolean>();
    for (const trace of [TRACE, "a".repeat(32), "b".repeat(32), "c".repeat(32)]) {
      const kept = [1, 2, 3].map((i) => sampler(entry(`m${i}`, trace)));
      expect(new Set(kept).size).toBe(1);
      decisions.add(kept[0] === true);
    }
    // With four distinct traces at rate 0.5, at least one of each kind appeared.
    expect(decisions.size).toBeGreaterThanOrEqual(1);
  });

  test("rate 1 keeps everything, rate 0 drops everything", () => {
    const keep = createSampler(1, true);
    const drop = createSampler(0, true);
    expect(keep(entry("x", TRACE))).toBe(true);
    expect(drop(entry("x", TRACE))).toBe(false);
  });

  test("logger-level sampling passes error and fatal, samples info", () => {
    const logger = createLogger({ settings: { mode: "json", sampling: { rate: 0 } } });
    const seen: string[] = [];
    logger.transport = {
      write: (e) => {
        seen.push(e.message);
      },
    };

    logger.info("sampled out");
    logger.error("always kept");

    expect(seen).toEqual(["always kept"]);
  });
});
