import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { captureConsole, fromEnv } from "@/index.logger";
import { captureLogger } from "@/testing";
import type { LogEntry } from "@/types/logger";

describe("captureConsole", () => {
  test("routes console methods into logger levels and restores cleanly", () => {
    const { entries, logger } = captureLogger({ level: "debug", mode: "json" });
    const originalLog = console.log;

    const handle = captureConsole(logger);
    console.log("via log");
    console.warn("via warn");
    console.error("via error");
    console.debug("via debug");
    console.info({ json: true });
    handle.restore();

    expect(console.log).toBe(originalLog);
    const pairs = entries.map((item) => [item.level, item.message] as const);
    expect(pairs).toContainEqual(["info", "via log"]);
    expect(pairs).toContainEqual(["warn", "via warn"]);
    expect(pairs).toContainEqual(["error", "via error"]);
    expect(pairs).toContainEqual(["debug", "via debug"]);
    expect(pairs.some(([level, message]) => level === "info" && message.includes("json"))).toBe(
      true,
    );
  });

  test("the logger's own console output bypasses the capture", () => {
    const { logger } = captureLogger({ level: "debug" });
    const handle = captureConsole(logger);

    let reentered = false;
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      reentered = true;
      originalError(...args);
    };
    logger.error("own output");
    console.error = originalError;
    handle.restore();

    expect(reentered).toBe(false);
  });
});

describe("fromEnv", () => {
  test("builds the full basic setup from environment variables", async () => {
    const logger = fromEnv({
      LOG_COLOR: "false",
      LOG_LEVEL: "warn",
      LOG_MODE: "json",
    });

    const captured: LogEntry[] = [];
    logger.transport = {
      write: (e) => {
        captured.push(e);
      },
    };
    logger.debug("silent");
    logger.warn("visible");

    expect(captured.map((item) => item.level)).toEqual(["warn"]);
    await logger.close();
  });

  test("LOG_FILE enables json file output", async () => {
    const dir = path.join(tmpdir(), `hp-from-env-${Date.now()}`);
    const filePath = path.join(dir, "from-env.log");
    const logger = fromEnv({ LOG_FILE: filePath });
    logger.info("file me");
    await logger.close();

    expect(readFileSync(filePath, "utf-8")).toContain("file me");
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("serializers", () => {
  test("transforms matching context keys before redaction", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      serializers: { user: (u) => ({ id: (u as { id: number }).id }) },
    });

    logger.info("login", { user: { id: 7, password: "secret" } });
    const context = (entries[0] as LogEntry).context as { user: { id: number } };
    expect(context.user).toEqual({ id: 7 });
  });

  test("a throwing serializer masks the key", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      serializers: {
        boom: () => {
          throw new Error("serializer bomb");
        },
      },
    });

    logger.info("x", { boom: { a: 1 } });
    const context = (entries[0] as LogEntry).context as { boom: string };
    expect(context.boom).toBe("[SERIALIZER ERROR]");
  });
});

describe("assert and groups", () => {
  test("assert logs an error only on falsy conditions", () => {
    const { entries, logger } = captureLogger({ mode: "json" });

    logger.assert(true, "never");
    const broken = Number.MAX_SAFE_INTEGER < Number.MIN_SAFE_INTEGER;
    logger.assert(broken, "math broke");
    logger.assert(0);

    const messages = entries.map((item) => item.message);
    expect(messages).toEqual(["Assertion failed: math broke", "Assertion failed"]);
    expect(entries.at(-1)?.level).toBe("error");
  });

  test("group and groupEnd indent subsequent entries", () => {
    const { entries, logger } = captureLogger({ mode: "pretty" });

    logger.group("request");
    logger.info("inside");
    logger.group("db");
    logger.info("nested");
    logger.groupEnd();
    logger.info("back-out");
    logger.groupEnd();
    logger.info("outside");

    const groups = entries.map((item) => item.context.group as string | undefined);
    expect(groups).toEqual(["request", "request.db", "request", undefined]);
  });

  test("groupEnd on an empty stack is a no-op", () => {
    const { logger } = captureLogger();
    expect(() => logger.groupEnd()).not.toThrow();
  });
});
