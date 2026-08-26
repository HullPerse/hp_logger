import { afterEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/index.logger";
import type { LogEntry } from "@/types/logger";
import type { Transport } from "@/types/transport";

interface ConsoleSpies {
  calls: { channel: string; output: string }[];
  restore: () => void;
}

const spyConsole = (): ConsoleSpies => {
  const calls: { channel: string; output: string }[] = [];
  const original = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.debug = (line: unknown): void => {
    calls.push({ channel: "debug", output: String(line) });
  };
  console.error = (line: unknown): void => {
    calls.push({ channel: "error", output: String(line) });
  };
  console.log = (line: unknown): void => {
    calls.push({ channel: "log", output: String(line) });
  };
  console.warn = (line: unknown): void => {
    calls.push({ channel: "warn", output: String(line) });
  };
  return {
    calls,
    restore: () => {
      console.debug = original.debug;
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
  };
};

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  const pending = [...cleanups];
  cleanups = [];
  await Promise.all(pending.map((cleanup) => cleanup()));
});

const track = (logger: { close: () => Promise<void> }): void => {
  cleanups.push(() => logger.close());
};

describe("bufferedConsole", () => {
  test("default off writes one stdio call per entry", () => {
    const spies = spyConsole();
    try {
      const logger = createLogger({ settings: { mode: "json" } });
      track(logger);
      logger.info("first");
      logger.info("second");
      const logCalls = spies.calls.filter((item) => item.channel === "log");
      expect(logCalls).toHaveLength(2);
      expect(logCalls[0]?.output).toContain("first");
      expect(logCalls[1]?.output).toContain("second");
    } finally {
      spies.restore();
    }
  });

  test("enabled coalesces info lines into one stdout chunk on flush", async () => {
    const spies = spyConsole();
    try {
      const logger = createLogger({ settings: { bufferedConsole: true, mode: "json" } });
      track(logger);
      logger.info("alpha");
      logger.info("beta");
      expect(spies.calls).toHaveLength(0);
      await logger.flush();
      const logCalls = spies.calls.filter((item) => item.channel === "log");
      expect(logCalls).toHaveLength(1);
      expect(logCalls[0]?.output).toContain("alpha");
      expect(logCalls[0]?.output).toContain("beta");
    } finally {
      spies.restore();
    }
  });

  test("warn and error lines leave through the stderr channel", async () => {
    const spies = spyConsole();
    try {
      const logger = createLogger({ settings: { bufferedConsole: true, mode: "json" } });
      track(logger);
      logger.warn("careful");
      logger.error("broken");
      await logger.flush();
      const errCalls = spies.calls.filter((item) => item.channel === "error");
      expect(errCalls).toHaveLength(1);
      expect(errCalls[0]?.output).toContain("careful");
      expect(errCalls[0]?.output).toContain("broken");
      expect(spies.calls.filter((item) => item.channel === "log")).toHaveLength(0);
    } finally {
      spies.restore();
    }
  });

  test("the line cap flushes without waiting for the timer", () => {
    const spies = spyConsole();
    try {
      const logger = createLogger({ settings: { bufferedConsole: true, mode: "json" } });
      track(logger);
      for (let i = 0; i < 64; i += 1) logger.info(`line-${i}`);
      const logCalls = spies.calls.filter((item) => item.channel === "log");
      expect(logCalls).toHaveLength(1);
      expect(logCalls[0]?.output.split("\n")).toHaveLength(64);
      logger.info("after cap");
      expect(spies.calls.filter((item) => item.channel === "log")).toHaveLength(1);
    } finally {
      spies.restore();
    }
  });

  test("close drains pending lines", async () => {
    const spies = spyConsole();
    try {
      const logger = createLogger({ settings: { bufferedConsole: true, mode: "json" } });
      logger.info("tail");
      await logger.close();
      const logCalls = spies.calls.filter((item) => item.channel === "log");
      expect(logCalls).toHaveLength(1);
      expect(logCalls[0]?.output).toContain("tail");
      // A second close or flush must not re-emit anything.
      await logger.flush();
      expect(spies.calls.filter((item) => item.channel === "log")).toHaveLength(1);
    } finally {
      spies.restore();
    }
  });

  test("a sync-throwing transport never crashes the caller", async () => {
    const logger = createLogger({ settings: { mode: "json" } });
    track(logger);
    logger.transport = {
      write: () => {
        throw new Error("sync boom");
      },
    };
    expect(() => logger.info("survives")).not.toThrow();
  });

  test("an async transport rejection is swallowed", async () => {
    const logger = createLogger({ settings: { mode: "json" } });
    track(logger);
    const { promise, reject } = Promise.withResolvers<unknown>();
    let seen = false;
    const transport: Transport = {
      write: () => {
        seen = true;
        // The deferred never resolves; only the rejection below matters.
        return promise as Promise<void>;
      },
    };
    logger.transport = transport;
    logger.info("async");
    expect(seen).toBe(true);
    reject(new Error("async boom"));
    // Give microtasks a tick; an unhandled rejection would fail the suite.
    await Bun.sleep(10);
  });

  test("custom transports returning plain values keep working", async () => {
    const logger = createLogger({ settings: { mode: "json" } });
    track(logger);
    const seen: LogEntry[] = [];
    const transport: Transport = {
      write: (entry) => {
        seen.push(entry);
      },
    };
    logger.transport = transport;
    logger.info("plain");
    expect(seen).toHaveLength(1);
  });
});
