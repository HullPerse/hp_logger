import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import { formatEntry } from "@/format/entry.format";
import { createLogger, Logger } from "@/index.logger";
import { resolveEnvLevel } from "@/lib/settings.utils";
import { captureConsole, captureLogger, withMutedConsole } from "@/lib/tests/test.transport";
import { redact } from "@/redact/index.redact";
import type { LogEntry, LoggerSettings } from "@/types/logger";
import type { Transport } from "@/types/transport";

const captureEntries = (
  settings: LoggerSettings = {},
): { entries: LogEntry[]; logger: Logger; transport: Transport } => captureLogger(settings);

describe("Logger", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    Logger.clearTransports();
  });

  test("creates logger with default options", () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.module).toBe("function");
    expect(typeof logger.settings).toBe("function");
    expect(typeof logger.close).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.time).toBe("function");
    expect(typeof logger.once).toBe("function");
    expect(typeof logger.throttle).toBe("function");
    expect(typeof logger.withContext).toBe("function");
  });

  test("test console wrapper restores state after a rejected callback", () => {
    const original = {
      debug: console.debug,
      error: console.error,
      log: console.log,
      warn: console.warn,
    };

    expect(
      withMutedConsole(() => {
        throw new Error("test failure");
      }),
    ).rejects.toThrow("test failure");

    expect({
      debug: console.debug,
      error: console.error,
      log: console.log,
      warn: console.warn,
    }).toEqual(original);
  });

  test("emits every level in ascending order", () => {
    const { entries, logger } = captureEntries({ level: "trace" });
    logger.trace("trace message");
    logger.debug("debug message");
    logger.info("info message");
    logger.success("success message");
    logger.warn("warn message");
    logger.error("error message");
    logger.fatal("fatal message");

    expect(entries.map(({ level, message }) => [level, message])).toEqual([
      ["trace", "trace message"],
      ["debug", "debug message"],
      ["info", "info message"],
      ["success", "success message"],
      ["warn", "warn message"],
      ["error", "error message"],
      ["fatal", "fatal message"],
    ]);
  });

  test("drops entries below the configured level", () => {
    const { entries, logger } = captureEntries({ level: "warn" });
    logger.debug("debug message");
    logger.info("info message");
    logger.success("success message");
    logger.warn("warn message");
    logger.error("error message");

    expect(entries.map(({ level, message }) => [level, message])).toEqual([
      ["warn", "warn message"],
      ["error", "error message"],
    ]);
  });

  test("module overrides level and child preserves context", () => {
    const { entries, logger, transport } = captureEntries({ level: "warn" });
    const auth = logger.module("auth", { level: "debug" });
    const child = auth.child({ requestId: "123" });
    auth.transport = transport;
    child.transport = transport;
    auth.debug("module debug");
    auth.info("module info");
    child.warn("child warning");

    expect(
      entries.map(({ author, context, level, message }) => ({ author, context, level, message })),
    ).toEqual([
      { author: "auth", context: {}, level: "debug", message: "module debug" },
      { author: "auth", context: {}, level: "info", message: "module info" },
      { author: "auth", context: { requestId: "123" }, level: "warn", message: "child warning" },
    ]);
  });

  test("module without override keeps the inherited level", () => {
    const { entries, logger, transport } = captureEntries({ level: "warn" });
    const moduleLogger = logger.module("auth");
    moduleLogger.transport = transport;
    moduleLogger.debug("hidden");
    moduleLogger.warn("visible");

    expect(entries.map(({ message }) => message)).toEqual(["visible"]);
  });

  test("settings changes the observable level gate after creation", () => {
    const { entries, logger, transport } = captureEntries();
    logger.settings({ level: "warn" });
    logger.transport = transport;
    logger.debug("hidden");
    logger.warn("visible");

    expect(entries.map(({ level, message }) => [level, message])).toEqual([["warn", "visible"]]);
  });

  test("redacts sensitive data in emitted entries", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.info("user login", {
      normal: "value",
      password: "secret123",
      token: "abc",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.context).toEqual({
      normal: "value",
      password: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  test("redacts bearer tokens", () => {
    const result = redact({ auth: "Bearer secret-token-here" }, /token/iu);
    expect(result).toEqual({ auth: "Bearer [REDACTED]" });
  });

  test("redacts custom key patterns without losing the fast path", () => {
    const result = redact({ apiKey: "secret-value", requestId: "req-1" }, /apiKey/iu);
    expect(result).toEqual({ apiKey: "[REDACTED]", requestId: "req-1" });
  });

  test("settings can explicitly disable redaction after creation", () => {
    const { entries, logger, transport } = captureLogger({ mode: "json" });
    logger.settings({ redactKeys: null });
    logger.transport = transport;
    logger.info("token=visible");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("token=visible");
  });

  test("addContext and logEvent emit the expected context", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.addContext({ service: "api" });
    logger.logEvent("info", "user_action", { action: "click" });

    expect(entries).toEqual([
      expect.objectContaining({
        context: { action: "click", event: "user_action", service: "api" },
        level: "info",
        message: "user_action",
      }),
    ]);
  });

  test("batching forwards entries before close resolves", async () => {
    const { entries, logger } = captureEntries({
      batching: { batchSize: 2, flushInterval: 60_000 },
      level: "debug",
    });
    logger.info("async message");
    logger.debug("another message");
    await logger.close();

    expect(entries.map(({ message }) => message)).toEqual(["async message", "another message"]);
  });

  test("stats exposes dropped async entries after the queue is full", async () => {
    const { logger } = captureEntries({
      batching: { batchSize: 10, maxQueueSize: 2 },
      level: "debug",
    });
    logger.info("first");
    logger.info("second");
    logger.info("dropped");

    expect(logger.stats()).toEqual({ dropped: 1, queued: 2, transportErrors: 0 });
    await logger.close();
    expect(logger.stats()).toEqual({ dropped: 1, queued: 0, transportErrors: 0 });
  });

  test("createLogger with json mode", () => {
    const { entries, logger } = captureEntries({ level: "debug", mode: "json" });
    logger.info("json message", { key: "value" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ context: { key: "value" }, message: "json message" });
  });

  test("colors can be disabled", () => {
    const { entries, logger } = captureEntries({ colors: false, level: "debug" });
    logger.info("plain message");

    expect(entries.map(({ message }) => message)).toEqual(["plain message"]);
  });

  test("colors can be overridden", () => {
    const { entries, logger } = captureEntries({ colors: { info: "cyan" }, level: "debug" });
    logger.info("cyan info");

    expect(entries.map(({ message }) => message)).toEqual(["cyan info"]);
  });

  test("file transport can be enabled", async () => {
    const logger = createLogger({
      settings: {
        file: { enabled: true, path: "/tmp/hp-logger-test.log" },
        level: "debug",
      },
    });
    await withMutedConsole(async () => {
      logger.info("file message");
      await logger.close();
    });
    const content = await Bun.file("/tmp/hp-logger-test.log").text();
    expect(content).toContain("file message");
    await Bun.$`rm -f /tmp/hp-logger-test.log`;
  });

  test("filters drop entries before the transport and preserve accepted entries", () => {
    const { entries, logger } = captureEntries({
      filters: [(entry) => entry.message !== "hidden"],
      level: "debug",
    });
    logger.info("hidden");
    logger.info("visible");

    expect(entries.map(({ message }) => message)).toEqual(["visible"]);
  });

  test("redact serializes Error with name, message and stack", () => {
    const result = redact(new Error("boom"), /secret/iu);
    expect(result).toEqual({
      message: "boom",
      name: "Error",
      stack: expect.stringContaining("boom"),
    });
  });

  test("redact serializes nested Error in context", () => {
    const result = redact({ error: new Error("query failed"), source: "db" }, /secret/iu);
    expect(result).toEqual({
      error: {
        message: "query failed",
        name: "Error",
        stack: expect.stringContaining("query failed"),
      },
      source: "db",
    });
  });

  test("redact does not truncate strings", () => {
    const long = "x".repeat(5000);
    const result = redact(long, /secret/iu);
    expect(result).toBe(long);
  });

  test("enabled false skips all entries", async () => {
    const logger = createLogger({
      settings: {
        enabled: false,
        file: { enabled: true, path: "/tmp/hp-logger-disabled.log" },
        level: "debug",
      },
    });
    logger.info("should not appear");
    await logger.close();
    expect(await Bun.file("/tmp/hp-logger-disabled.log").exists()).toBe(false);
  });

  test("file mode pretty writes readable lines", async () => {
    const logger = createLogger({
      settings: {
        file: {
          enabled: true,
          mode: "pretty",
          path: "/tmp/hp-logger-pretty.log",
        },
        level: "debug",
      },
    });
    await withMutedConsole(async () => {
      logger.info("hello pretty");
      await logger.close();
    });
    const content = await Bun.file("/tmp/hp-logger-pretty.log").text();
    expect(content).toContain("[INFO]");
    expect(content).toContain("hello pretty");
    expect(content).not.toContain('"level"');
    await Bun.$`rm -f /tmp/hp-logger-pretty.log`;
  });

  test("redactDepth limits nested context serialization", () => {
    const { entries, logger } = captureEntries({ level: "debug", redactDepth: 1 });
    logger.info("deep context", { outer: { inner: { deepest: "x" } } });

    expect(entries[0]?.context).toEqual({ outer: { inner: "[REDACTED]" } });
  });

  test("pretty output uses separate time/date/year tags by defaulting to time only", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          level: "info",
          mode: "pretty",
          showAuthor: false,
          showDate: true,
          showLevel: true,
          showYear: true,
        },
      });
      logger.info("hello tags");
    } finally {
      restore();
    }
    const output = outputs[0] ?? "";
    expect(output.startsWith("[")).toBe(true);
    expect(output).toContain("] [");
    expect(output).toContain("[INFO] hello tags");
  });

  test("pretty output colors tags but not the message", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { level: "info", mode: "pretty", showAuthor: false },
      });
      logger.info("plain message");
    } finally {
      restore();
    }
    const output = outputs[0] ?? "";
    expect(output).toContain("plain message");
    expect(output.endsWith("plain message")).toBe(true);
    expect(output.includes(String.fromCodePoint(27))).toBe(true);
  });

  test("showLevel renders level prefix in pretty output", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          level: "info",
          mode: "pretty",
          showLevel: true,
        },
      });
      logger.info("hello level");
    } finally {
      restore();
    }
    expect(outputs.some((out) => out.includes("[INFO]"))).toBe(true);
  });

  test('formatContext kv renders key="value" pairs in pretty output', () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          formatContext: "kv",
          level: "info",
          mode: "pretty",
        },
      });
      logger.info("hello ctx", { name: "vasya", userId: 42 });
    } finally {
      restore();
    }
    expect(outputs.some((out) => out.includes('name="vasya" userId=42'))).toBe(true);
    expect(outputs.some((out) => out.includes('{"name"'))).toBe(false);
  });

  test("formatContext json is default", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "info", mode: "pretty" },
      });
      logger.info("hello ctx", { userId: 42 });
    } finally {
      restore();
    }
    expect(outputs.some((out) => out.includes('{"userId":42}'))).toBe(true);
  });

  test("showLevel false hides level prefix", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "info", mode: "pretty" },
      });
      logger.info("hello no level");
    } finally {
      restore();
    }
    expect(outputs.some((out) => out.includes("[INFO]"))).toBe(false);
  });

  test("settings can toggle enabled after creation", async () => {
    const logger = createLogger({
      settings: {
        file: { enabled: true, path: "/tmp/hp-logger-toggle.log" },
        level: "debug",
      },
    });
    await withMutedConsole(async () => {
      logger.settings({ enabled: false });
      logger.info("suppressed");
      logger.settings({ enabled: true });
      logger.info("visible again");
      await logger.close();
    });
    const content = await Bun.file("/tmp/hp-logger-toggle.log").text();
    expect(content).toContain("visible again");
    expect(content).not.toContain("suppressed");
    await Bun.$`rm -f /tmp/hp-logger-toggle.log`;
  });

  test("resolveEnvLevel reads LOG_LEVEL from env", () => {
    expect(resolveEnvLevel({ LOG_LEVEL: "warn" })).toBe("warn");
    expect(resolveEnvLevel({ LOG_LEVEL: "debug" })).toBe("debug");
    expect(resolveEnvLevel({})).toBe("info");
    expect(resolveEnvLevel({ LOG_LEVEL: "bogus" })).toBe("info");
  });

  test("createLogger uses LOG_LEVEL from env when level is not set", () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const logger = createLogger();
      expect(logger).toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }
  });
  test("daily rotation shares one file per day between loggers", async () => {
    const dir = `/tmp/hp-logger-shared-${Date.now()}`;
    const a = createLogger({
      settings: {
        file: { enabled: true, path: dir, rotation: "daily" },
        level: "debug",
      },
    });
    const b = createLogger({
      settings: {
        file: { enabled: true, path: dir, rotation: "daily" },
        level: "debug",
      },
    });
    await withMutedConsole(async () => {
      a.info("from logger a");
      b.info("from logger b");
      await a.close();
      await b.close();
    });
    const [dateStr] = new Date().toISOString().split("T");
    const dateDir = `${dir}/${dateStr}`;
    const lsOutput = await Bun.$`ls ${dateDir}`.text();
    const files = lsOutput.trim().split("\n");
    expect(files.filter((f) => f.startsWith("log_"))).toHaveLength(1);
    const content = await Bun.file(`${dateDir}/${files[0]}`).text();
    expect(content).toContain("from logger a");
    expect(content).toContain("from logger b");
    await Bun.$`rm -rf ${dir}`;
  });

  test("lazy message and context are not evaluated when level is disabled", () => {
    const { outputs, restore } = captureConsole();
    let evaluated = 0;
    try {
      const logger = createLogger({
        settings: { level: "info", mode: "json" },
      });
      logger.debug(
        () => {
          evaluated += 1;
          return "lazy debug message";
        },
        () => {
          evaluated += 1;
          return { expensive: evaluated };
        },
      );
      logger.info(() => {
        evaluated += 1;
        return "lazy info message";
      });
    } finally {
      restore();
    }
    // only the info thunk runs
    expect(evaluated).toBe(1);
    expect(outputs.some((out) => out.includes("lazy info message"))).toBe(true);
    expect(outputs.some((out) => out.includes("lazy debug message"))).toBe(false);
  });

  test("time returns the result and emits duration metadata", async () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    const result = await logger.time("db.query", () => 42);

    expect(result).toBe(42);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      context: { operation: "db.query" },
      level: "success",
      message: expect.stringContaining("db.query completed in"),
    });
    expect(entries[0]?.context.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("time rethrows a failed operation after logging its duration", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    expect(
      logger.time("db.query", () => {
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      context: { operation: "db.query" },
      message: expect.stringContaining("db.query completed in"),
    });
  });

  test("time warns and flags the entry when maxMs is exceeded", async () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    const result = await logger.time("slow.query", () => 1, { maxMs: -1 });

    expect(result).toBe(1);
    expect(entries[0]).toMatchObject({
      context: { maxMs: -1, operation: "slow.query", slow: true },
      level: "warn",
    });
  });

  test("span logs the duration on end", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    const span = logger.span("render", { maxMs: 10_000 });
    span.end();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      context: { operation: "render" },
      level: "success",
      message: expect.stringContaining("render completed in"),
    });
    expect(entries[0]?.context.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("span end accepts a level override", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.span("job").end("info");
    expect(entries[0]).toMatchObject({ context: { operation: "job" }, level: "info" });
  });

  test("context-first overload logs the context before the message", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.info({ userId: 42 }, "user saved");
    expect(entries[0]).toMatchObject({
      context: { userId: 42 },
      level: "info",
      message: "user saved",
    });
  });

  test("a bare object is printed as JSON", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.warn({ a: 1 });
    expect(entries[0]?.message).toBe(JSON.stringify({ a: 1 }));
    expect(entries[0]?.context).toEqual({});
    expect(entries[0]?.level).toBe("warn");
  });

  test("table logs aligned rows", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.table([
      { id: 1, name: "aa" },
      { id: 22, name: "b" },
    ]);
    const message = entries[0]?.message ?? "";
    expect(message).toContain("id");
    expect(message).toContain("1");
    expect(message).toContain("22");
  });

  test("pretty output supports emoji, elapsed tags and group indent", () => {
    const captured = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          emoji: true,
          level: "debug",
          mode: "pretty",
          showAuthor: false,
          showElapsed: true,
          showTime: false,
        },
      });
      logger.info("hello", { group: "request.db" });
      expect(captured.outputs[0]).toMatch(/^ {2}\[\+/u);
      expect(captured.outputs[0]).toContain("[ℹ️]");
      expect(captured.outputs[0]).toContain("hello");
    } finally {
      captured.restore();
    }
  });

  test("pretty renderer turns error context into a cause block", () => {
    const captured = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "debug", mode: "pretty", showTime: false },
      });
      logger.error("boom", { error: new Error("db down") });
      expect(captured.outputs[0]).toContain("boom");
      expect(captured.outputs[0]).toContain("✗ Error: db down");
    } finally {
      captured.restore();
    }
  });

  test("fatal entries carry a memory and uptime snapshot", () => {
    const { entries, logger } = captureEntries({ level: "trace" });
    logger.fatal("boom");

    const context = entries[0]?.context as {
      memory?: { heapTotal?: unknown; heapUsed?: unknown; rss?: unknown };
      uptimeMs?: unknown;
    };
    expect(typeof context.memory?.rss).toBe("number");
    expect(typeof context.memory?.heapTotal).toBe("number");
    expect(typeof context.memory?.heapUsed).toBe("number");
    expect(typeof context.uptimeMs).toBe("number");
  });

  test("non-fatal entries do not get the memory snapshot", () => {
    const { entries, logger } = captureEntries({ level: "trace" });
    logger.error("exploded");
    expect(entries[0]?.context.memory).toBeUndefined();
  });

  test("once logs a key only once", () => {
    const outputs: string[] = [];
    const original = console.warn;
    console.warn = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: { level: "debug", mode: "json" },
      });
      logger.once("db-down", "database down");
      logger.once("db-down", "database down again");
      logger.once("other-key", "other event");
    } finally {
      console.warn = original;
    }
    expect(outputs.filter((out) => out.includes("database down")).length).toBe(1);
    expect(outputs.filter((out) => out.includes("other event")).length).toBe(1);
  });

  test("throttle drops calls within the interval", () => {
    const outputs: string[] = [];
    const original = console.warn;
    console.warn = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: { level: "debug", mode: "json" },
      });
      logger.throttle("conn", 10_000, "connection failed");
      logger.throttle("conn", 10_000, "connection failed again");
      logger.throttle("other", 10_000, "other failure");
    } finally {
      console.warn = original;
    }
    expect(outputs.filter((out) => out.includes("connection failed")).length).toBe(1);
    expect(outputs.filter((out) => out.includes("other failure")).length).toBe(1);
  });

  test("context precedence is entry over async over static", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    logger.addContext({ requestId: "static", service: "api" });
    logger.withContext({ requestId: "async", userId: 7 }, () => {
      logger.info("precedence", { action: "read", requestId: "entry" });
    });

    expect(entries[0]?.context).toEqual({
      action: "read",
      requestId: "entry",
      service: "api",
      userId: 7,
    });
  });

  test("withContext merges async-local context into entries", async () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { level: "debug", mode: "json" },
      });
      await logger.withContext({ requestId: "abc" }, async () => {
        logger.info("inside run");
        await Promise.resolve();
        logger.info("still inside run");
      });
      logger.info("outside run");
    } finally {
      restore();
    }
    const inside = outputs.filter((out) => out.includes("requestId"));
    expect(inside).toHaveLength(2);
    expect(outputs.some((out) => out.includes("outside run") && !out.includes("requestId"))).toBe(
      true,
    );
  });

  test("fatal and trace levels render and respect ordering", () => {
    const outputs: string[] = [];
    const original = console.log;
    const originalError = console.error;
    console.log = (value: unknown) => {
      outputs.push(`log:${String(value)}`);
    };
    console.error = (value: unknown) => {
      outputs.push(`error:${String(value)}`);
    };
    try {
      const logger = createLogger({
        settings: { level: "trace", mode: "json" },
      });
      logger.trace("trace me");
      logger.fatal("fatal me");
      const filtered = createLogger({
        settings: { level: "error", mode: "json" },
      });
      filtered.trace("hidden trace");
      filtered.debug("hidden debug");
      filtered.fatal("kept fatal");
    } finally {
      console.log = original;
      console.error = originalError;
    }
    expect(outputs.some((out) => out.includes("trace me"))).toBe(true);
    expect(outputs.some((out) => out.includes("fatal me") && out.startsWith("error:"))).toBe(true);
    expect(outputs.some((out) => out.includes("hidden trace"))).toBe(false);
    expect(outputs.some((out) => out.includes("kept fatal"))).toBe(true);
  });

  test("nested withContext merges outer async-local context", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { level: "debug", mode: "json" },
      });
      logger.withContext({ requestId: "outer" }, () => {
        logger.withContext({ userId: 7 }, () => {
          logger.info("nested");
        });
      });
    } finally {
      restore();
    }
    expect(
      outputs.some((out) => out.includes('"requestId":"outer"') && out.includes('"userId":7')),
    ).toBe(true);
  });

  test("timestamp is deterministic with setSystemTime", () => {
    setSystemTime(new Date("2024-01-02T03:04:05.000Z"));
    try {
      const { entries, logger } = captureEntries({ file: false, level: "debug", mode: "json" });
      logger.info("timed");
      expect(entries[0]?.timestamp).toBe("2024-01-02 03:04:05");
    } finally {
      setSystemTime();
    }
  });

  test("prettyTruncate cuts long pretty lines with ellipsis", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          level: "info",
          mode: "pretty",
          prettyTruncate: 20,
        },
      });
      logger.info("a very long message that should be cut");
    } finally {
      restore();
    }
    const line = outputs[0] ?? "";
    expect(line.endsWith("…")).toBe(true);
  });

  test("prettyWrap wraps long pretty lines to the configured width", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          level: "info",
          mode: "pretty",
          prettyWrap: 40,
        },
      });
      logger.info("word ".repeat(20).trim());
    } finally {
      restore();
    }
    const line = outputs[0] ?? "";
    expect(line.includes("\n")).toBe(true);
  });

  test("custom format renders console pretty lines", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          format: (entry) => `${entry.level}:${entry.author}:${entry.message}`,
          level: "info",
          mode: "pretty",
        },
      });
      logger.info("hello custom");
    } finally {
      restore();
    }
    expect(outputs.some((out) => out.includes("info:ROOT:hello custom"))).toBe(true);
  });

  test("custom format renders file pretty lines", async () => {
    const logger = createLogger({
      settings: {
        file: {
          enabled: true,
          mode: "pretty",
          path: "/tmp/hp-logger-format.log",
        },
        format: (entry) => `${entry.level}|${entry.message}`,
        level: "debug",
        mode: "json",
      },
    });
    await withMutedConsole(async () => {
      logger.info("to file");
      await logger.close();
    });
    const content = await Bun.file("/tmp/hp-logger-format.log").text();
    expect(content).toContain("info|to file");
    await Bun.$`rm -f /tmp/hp-logger-format.log`;
  });

  test("addTransport writes to global transports for every logger", () => {
    const received: LogEntry[] = [];
    const transport: Transport = {
      write(entry: LogEntry) {
        received.push(entry);
      },
    };
    Logger.addTransport(transport);
    try {
      const { logger } = captureEntries({ level: "debug", mode: "json" });
      logger.info("hello global");
    } finally {
      Logger.removeTransport(transport);
    }
    expect(received.some((entry) => entry.message === "hello global")).toBe(true);
  });
});

const capturePrettyLine = (patch: Partial<LoggerSettings>, author: string): string => {
  const { outputs, restore } = captureConsole();
  try {
    const logger = createLogger({
      settings: {
        colors: false,
        mode: "pretty",
        showAuthor: true,
        showLevel: true,
        ...patch,
      },
    });
    logger.module(author).info("tagged");
  } finally {
    restore();
  }
  return outputs[0] ?? "";
};

describe("tagCase", () => {
  test("uppercases author and level tags by default", () => {
    const line = capturePrettyLine({}, "auth");
    expect(line).toContain("[AUTH]");
    expect(line).toContain("[INFO]");
    expect(line).not.toContain("[auth]");
  });

  test("none keeps the authored case", () => {
    const line = capturePrettyLine({ tagCase: "none" }, "auth");
    expect(line).toContain("[auth]");
    expect(line).toContain("[info]");
  });

  test("lower lowercases author and level tags", () => {
    const line = capturePrettyLine({ tagCase: "lower" }, "AUTH");
    expect(line).toContain("[auth]");
    expect(line).toContain("[info]");
  });

  test("json output keeps the raw author regardless of tagCase", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { mode: "json", tagCase: "lower" },
      });
      logger.module("MixedCase").info("raw");
    } finally {
      restore();
    }
    const parsed = JSON.parse(outputs[0] ?? "{}") as { author: string };
    expect(parsed.author).toBe("MixedCase");
  });

  test("formatEntry applies tagCase to file pretty lines", () => {
    const entry = {
      author: "db",
      context: {},
      level: "warn",
      message: "stored",
      timestamp: "2026-08-21 10:00:00",
    } as const;
    expect(formatEntry(entry, "pretty")).toBe("[2026-08-21 10:00:00] [DB] [WARN] stored");
    expect(formatEntry(entry, "pretty", "json", undefined, "none")).toBe(
      "[2026-08-21 10:00:00] [db] [warn] stored",
    );
  });

  test("stripControl removes terminal escapes from console output", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "debug", mode: "pretty", stripControl: true },
      });
      logger.info("clean\u001Bmessage");
    } finally {
      restore();
    }
    const line = outputs.at(-1) ?? "";
    expect(line).toContain("cleanmessage");
    expect(line).not.toContain("\u001B");
  });

  test("stripControl leaves escapes untouched when disabled", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "debug", mode: "pretty", stripControl: false },
      });
      logger.info("raw\u001B[2J");
    } finally {
      restore();
    }
    expect(outputs.at(-1) ?? "").toContain("\u001B[2J");
  });

  test("stripControl strips escapes from context in kv console output", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          formatContext: "kv",
          level: "debug",
          mode: "pretty",
          stripControl: true,
        },
      });
      logger.info("context", { user: "alice\u001B[31m" });
    } finally {
      restore();
    }
    const line = outputs.at(-1) ?? "";
    expect(line).toContain('user="alice[31m"');
    expect(line).not.toContain("\u001B");
  });

  test("stripControl sanitizes the pretty error block", () => {
    const { outputs, restore } = captureConsole();
    try {
      const logger = createLogger({
        settings: { colors: false, level: "debug", mode: "pretty", stripControl: true },
      });
      logger.error("db down", { error: new Error("boom\u001B[2J") });
    } finally {
      restore();
    }
    const line = outputs.at(-1) ?? "";
    expect(line).toContain("boom[2J");
    expect(line).not.toContain("\u001B");
  });

  test("a circular error cause serializes instead of recursing forever", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    const error = new Error("boom");
    (error as unknown as Record<string, unknown>).cause = error;
    logger.error("failed", { error });

    const [entry] = entries;
    const serialized = entry?.context.error as {
      cause?: { message?: string };
      message?: string;
    };
    expect(serialized.message).toBe("boom");
    expect(serialized.cause?.message).toBe("[Circular]");
  });

  test("a circular context object reaches the transport without throwing", () => {
    const { entries, logger } = captureEntries({ level: "debug" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.info("payload", { circular });

    const [entry] = entries;
    expect(entry?.message).toBe("payload");
    // The depth-limited redaction turns the deep cycle into a placeholder.
    expect(JSON.stringify(entry)).toContain("payload");
  });
});
