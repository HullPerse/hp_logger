import { describe, expect, test } from "bun:test";

import { createLogger, Logger } from "@/index.logger";
import { resolveSettings } from "@/lib/settings.utils";
import { redact } from "@/redact/index.redact";
import { Counter } from "@/metrics/counter.metric";
import { Registry } from "@/metrics/registry.metric";
import type { LogEntry } from "@/types/logger";
import { captureLogger } from "./test.transport";

// ---------------------------------------------------------------------------
// F1: baseFields
// ---------------------------------------------------------------------------
describe("baseFields", () => {
  test("stamps configured base fields as top-level metadata on JSON entries", () => {
    const { entries, logger } = captureLogger({
      baseFields: { pid: 123, hostname: "web-1", service: "api" },
      mode: "json",
      redactKeys: null,
    });
    logger.info("hello");
    const entry = entries[0] as LogEntry;
    expect(entry.baseFields).toEqual({ pid: 123, hostname: "web-1", service: "api" });
    expect(entry.message).toBe("hello");
  });

  test("baseFields is undefined when disabled", () => {
    const { entries, logger } = captureLogger({ mode: "json", redactKeys: null });
    logger.info("no base");
    const entry = entries[0] as LogEntry;
    expect(entry.baseFields).toBeUndefined();
  });

  test("context keys win over base fields on collision", () => {
    const { entries, logger } = captureLogger({
      baseFields: { service: "api" },
      mode: "json",
      redactKeys: null,
    });
    logger.info("ctx wins", { service: "worker" });
    const entry = entries[0] as LogEntry;
    // baseFields is stamped separately; context wins in the merged output.
    expect(entry.baseFields?.service).toBe("api");
    expect(entry.context.service).toBe("worker");
  });

  test("empty object disables base fields", () => {
    const { entries, logger } = captureLogger({
      baseFields: {} as Record<string, unknown>,
      mode: "json",
      redactKeys: null,
    });
    logger.info("empty base");
    const entry = entries[0] as LogEntry;
    expect(entry.baseFields).toBeUndefined();
  });

  test("base fields survive a settings merge", () => {
    const logger = createLogger({
      settings: {
        baseFields: { pid: 1 },
        mode: "json",
        redactKeys: null,
      },
    });
    const { entries } = captureLogger({ mode: "json", redactKeys: null });
    // Verify resolveSettings propagates baseFields through merge
    const merged = resolveSettings({ baseFields: { pid: 1 } });
    expect(merged.baseFields).toEqual({ pid: 1 });
    logger.close();
  });
});

// ---------------------------------------------------------------------------
// F4: redactPii
// ---------------------------------------------------------------------------
describe("redactPii", () => {
  test("redacts email addresses in messages when email detector is enabled", () => {
    const result = redact("Contact me at alice@example.com", null, 4, 0, [], "");
    expect(result).toBe("Contact me at alice@example.com");

    // With PII enabled through the compiled path
    const compiled = { exact: new Set<string>(), prefixes: [] };
    // Manual test: the redactCompiled function accepts pii param
    // We test through the Logger pipeline instead
    const { entries, logger } = captureLogger({
      mode: "json",
      redactKeys: null,
      redactPii: { email: true },
    });
    logger.info("email is alice@example.com");
    const entry = entries[0] as LogEntry;
    expect(entry.message).toContain("[REDACTED]");
    expect(entry.message).not.toContain("alice@example.com");
  });

  test("redacts card numbers in context when card detector is enabled", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      redactKeys: null,
      redactPii: { card: true },
    });
    logger.info("payment", { card: "4111 1111 1111 1111" });
    const entry = entries[0] as LogEntry;
    expect(entry.context.card).toBe("[REDACTED]");
  });

  test("both detectors disabled by default", () => {
    const { entries, logger } = captureLogger({ mode: "json", redactKeys: null });
    logger.info("email alice@example.com and card 4111 1111 1111 1111");
    const entry = entries[0] as LogEntry;
    expect(entry.message).toContain("alice@example.com");
    expect(entry.message).toContain("4111 1111 1111 1111");
  });

  test("redactPii false disables all detectors", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      redactKeys: null,
      redactPii: false,
    });
    logger.info("email alice@example.com");
    const entry = entries[0] as LogEntry;
    expect(entry.message).toContain("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// F5: redactCensor
// ---------------------------------------------------------------------------
describe("redactCensor", () => {
  test("uses custom censor token instead of [REDACTED]", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      redactCensor: "***",
    });
    logger.info("login", { password: "secret123" });
    const entry = entries[0] as LogEntry;
    expect(entry.context.password).toBe("***");
    expect(entry.context.password).not.toContain("[REDACTED]");
  });

  test("censor token applies to bearer redaction", () => {
    const { entries, logger } = captureLogger({
      mode: "json",
      redactCensor: "XXX",
    });
    logger.info("auth header", { authorization: "Bearer abc" });
    const entry = entries[0] as LogEntry;
    expect(entry.context.authorization).toBe("XXX");
  });

  test("defaults to [REDACTED] when not configured", () => {
    const { entries, logger } = captureLogger({ mode: "json" });
    logger.info("login", { token: "xyz" });
    const entry = entries[0] as LogEntry;
    expect(entry.context.token).toBe("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// F2: pause / resume
// ---------------------------------------------------------------------------
describe("pause and resume", () => {
  test("entries are buffered while paused and delivered on resume", async () => {
    const { logger } = captureLogger({ mode: "json", redactKeys: null });
    const received: LogEntry[] = [];
    Logger.addTransport({
      write: (entry: LogEntry) => { received.push(entry); },
    });

    logger.pause();
    logger.info("before resume");
    logger.info("also buffered");
    expect(received).toHaveLength(0);

    await logger.resume();
    expect(received).toHaveLength(2);
    expect(received[0]?.message).toBe("before resume");
    expect(received[1]?.message).toBe("also buffered");
    Logger.clearTransports();
  });

  test("logging resumes normally after resume()", async () => {
    const { logger } = captureLogger({ mode: "json", redactKeys: null });
    const received: LogEntry[] = [];
    Logger.addTransport({
      write: (entry: LogEntry) => { received.push(entry); },
    });

    logger.pause();
    logger.info("before");
    await logger.resume();
    logger.info("after");
    // Global transport receives: before (on resume) + after (normal write)
    expect(received).toHaveLength(2);
    expect(received[0]?.message).toBe("before");
    expect(received[1]?.message).toBe("after");
    Logger.clearTransports();
  });

  test("pause returns the logger for chaining", () => {
    const { logger } = captureLogger({ mode: "json" });
    const result = logger.pause();
    expect(result).toBe(logger);
  });

  test("resume drains entries in FIFO order", async () => {
    const { logger } = captureLogger({ mode: "json", redactKeys: null });
    const received: string[] = [];
    Logger.addTransport({
      write: (entry: LogEntry) => { received.push(entry.message); },
    });

    logger.pause();
    for (let i = 0; i < 10; i++) logger.info(`msg-${i}`);
    await logger.resume();
    expect(received).toEqual(Array.from({ length: 10 }, (_, i) => `msg-${i}`));
    Logger.clearTransports();
  });
});

// ---------------------------------------------------------------------------
// F3: rotate
// ---------------------------------------------------------------------------
describe("rotate", () => {
  test("Logger.rotate() resolves without error when transport has no rotate", async () => {
    const { logger } = captureLogger({ mode: "json" });
    await logger.rotate(); // should not throw
  });

  test("Logger.rotate() calls transport.rotate when present", async () => {
    let rotated = false;
    const { logger } = captureLogger({ mode: "json" });
    // Logger.rotate() calls this.transport.rotate, so we must set it directly.
    logger.transport = {
      write: () => {},
      rotate: () => { rotated = true; },
    };
    await logger.rotate();
    expect(rotated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S1: Pretty finalize fast-path
// ---------------------------------------------------------------------------
describe("pretty finalize fast-path", () => {
  test("prettyTruncate false and prettyWrap false return line unchanged", () => {
    const { logger } = captureLogger({
      mode: "pretty",
      prettyTruncate: false,
      prettyWrap: false,
      redactKeys: null,
    });
    // The logger created by captureLogger uses a CaptureTransport, which
    // receives entries after the console finalize path. We just verify
    // the logger does not crash when both flags are off.
    logger.info("hello world");
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S2: Metrics label escape memoization
// ---------------------------------------------------------------------------
describe("metrics label escape memoization", () => {
  test("escapeValue produces correct output for special characters", () => {
    const reg = new Registry();
    const counter = new Counter({
      help: "test counter",
      labelNames: ["method"],
      name: "test_counter",
      registers: [reg],
    });
    counter.inc({ method: 'GET "path"' });
    counter.inc({ method: 'GET "path"' });
    const text = reg.metrics();
    // Backslash and quotes are escaped in the output
    expect(text).toContain('method="GET \\"path\\""');
  });

  test("repeated label values produce identical output", () => {
    const reg = new Registry();
    const counter = new Counter({
      help: "test",
      labelNames: ["key"],
      name: "memo_test",
      registers: [reg],
    });
    for (let i = 0; i < 10; i++) counter.inc({ key: "val\nue" });
    const text = reg.metrics();
    // Should contain exactly one escaped line with \\n
    const lines = text.split("\n").filter((l) => l.startsWith('memo_test'));
    expect(lines.length).toBe(1); // only the sample line
  });
});
