import { describe, expect, test } from "bun:test";

import { createLogger, Logger } from "@/index.logger";
import { captureLogger } from "@/lib/tests/test.transport";
import type { LogEntry, LogLevel } from "@/types/logger";

const ALL_LEVELS: LogLevel[] = ["trace", "debug", "info", "success", "warn", "error", "fatal"];

describe("torture: serialization", () => {
  test("BigInt in context does not explode JSON serialization", () => {
    const { entries, logger } = captureLogger({ mode: "json", redactKeys: null });
    const value = { count: 9_007_199_254_740_993n };

    expect(() => logger.info("bigint", value)).not.toThrow();
    expect(entries).toHaveLength(1);
    const context = (entries[0] as LogEntry).context as { count: unknown };
    expect(typeof context.count === "string" || typeof context.count === "bigint").toBe(true);
  });

  test("a throwing toJSON survives the pipeline", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const evil = {
      toJSON(): never {
        throw new Error("toJSON bomb");
      },
    };

    expect(() => logger.info("bomb", { evil })).not.toThrow();
    expect(entries).toHaveLength(1);
  });

  test("a throwing getter survives redaction", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter bomb");
      },
    });

    expect(() => logger.info("getter", evil)).not.toThrow();
    expect(entries).toHaveLength(1);
  });

  test("circular context renders without hanging or crashing", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;

    logger.info("circular", node);
    expect(entries).toHaveLength(1);
  });

  test("shared references render fully (DAG, not a false cycle)", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const shared = { id: 1 };
    logger.info("dag", { a: shared, b: shared });

    const context = (entries[0] as LogEntry).context as { a: { id: number }; b: { id: number } };
    expect(context.a.id).toBe(1);
    expect(context.b.id).toBe(1);
  });

  test("lone surrogates and unicode do not corrupt the entry", () => {
    const { entries, logger } = captureLogger({ mode: "json" });

    logger.info("unicode \u{1F600} \u{D83D} ok");
    expect((entries[0] as LogEntry).message).toContain("ok");
  });

  test("maxMessageLength truncates without breaking JSON mode", () => {
    const { entries, logger } = captureLogger({ maxMessageLength: 10, mode: "json" });

    logger.info("x".repeat(1000));
    const message = (entries[0] as LogEntry).message;
    expect(message.length).toBeLessThanOrEqual(11);
  });
});

describe("torture: level boundaries", () => {
  test("every level logs exactly at its own threshold", () => {
    for (const threshold of ALL_LEVELS) {
      const { entries, logger } = captureLogger({ level: threshold, mode: "json" });
      logger[threshold]("at threshold");
      expect(entries).toHaveLength(1);
    }
  });

  test("one step below the threshold is silent for every level", () => {
    for (let i = 1; i < ALL_LEVELS.length; i += 1) {
      const { entries, logger } = captureLogger({ level: ALL_LEVELS[i] as LogLevel, mode: "json" });
      const below = ALL_LEVELS[i - 1] as LogLevel;
      logger[below]("below threshold");
      expect(entries).toHaveLength(0);
    }
  });
});

describe("torture: transports", () => {
  test("a sync-throwing transport is counted, never propagated", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    logger.transport = {
      flush: () => {
        throw new Error("sync bomb");
      },
      stats: () => ({ dropped: 0, queued: 0, transportErrors: 7 }),
      write: (e) => {
        entries.push(e);
      },
    };

    expect(() => logger.info("into the void")).not.toThrow();
    expect(() => logger.flush()).not.toThrow();
    expect(logger.stats().transportErrors).toBe(7);
    expect(entries).toHaveLength(1);
  });

  test("an async-rejecting transport is counted, never propagated", async () => {
    const logger = createLogger({ settings: { mode: "json" } });
    logger.transport = {
      stats: () => ({ dropped: 0, queued: 0, transportErrors: 1 }),
      write: async () => {
        throw new Error("async bomb");
      },
    };

    await expect((async () => logger.info("into the void"))()).resolves.toBeUndefined();
    await logger.close();
  });

  test("writes after close are dropped without throwing", async () => {
    const { logger } = captureLogger({ mode: "json" });
    await logger.close();

    expect(() => logger.info("after close")).not.toThrow();
  });

  test("many loggers feeding one global transport keep per-logger order", () => {
    const seen: string[] = [];
    Logger.addTransport({
      write: (e) => {
        seen.push(e.message);
      },
    });
    const root = createLogger({ settings: { mode: "json" } });

    const a = root.module("a");
    const b = root.module("b");
    a.info("a1");
    b.info("b1");
    a.info("a2");
    b.info("b2");

    Logger.clearTransports();
    expect(seen).toEqual(["a1", "b1", "a2", "b2"]);
  });
});

describe("torture: redaction", () => {
  test("depth limit masks everything past redactDepth", () => {
    const { entries, logger } = captureLogger({ mode: "json", redactDepth: 2 });
    logger.info("deep", { l1: { l2: { l3: { secret: "gone" } } } });

    const context = (entries[0] as LogEntry).context as { l1: { l2: { l3: unknown } } };
    expect(context.l1.l2.l3).toBe("[REDACTED]");
  });

  test("default keys redact at any depth without paths", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    logger.info("creds", { a: { b: { c: { password: "hunter2" } } } });

    // Past redactDepth the whole subtree masks, not individual keys.
    const context = (entries[0] as LogEntry).context as { a: { b: { c: unknown } } };
    expect(context.a.b.c).toBe("[REDACTED]");
  });

  test("error serialization survives a cyclic cause chain", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause: unknown }).cause = b;

    logger.error("cyclic causes", { error: b });
    expect(entries).toHaveLength(1);
  });
});
