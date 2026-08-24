import { describe, expect, test } from "bun:test";

import { AdaptiveTransport } from "@/writer/adaptive.writer";
import type { LogEntry } from "@/types/logger";

const entry = (message: string, level: LogEntry["level"] = "info"): LogEntry => ({
  author: "test",
  context: {},
  level,
  message,
  timestamp: "2026-08-24 12:00:00",
});

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

describe("AdaptiveTransport", () => {
  test("passes everything through in normal operation", () => {
    const received: LogEntry[] = [];
    const adaptive = new AdaptiveTransport(
      {
        write: (item) => {
          received.push(item);
        },
      },
      { errorRate: 2, windowMs: 60_000 },
    );
    adaptive.write(entry("info one"));
    adaptive.write(entry("debug two", "debug"));
    adaptive.write(entry("warn three", "warn"));
    expect(received.map((item) => item.message)).toEqual(["info one", "debug two", "warn three"]);
  });

  test("switches to throttled when the error rate exceeds the threshold", () => {
    const received: LogEntry[] = [];
    const adaptive = new AdaptiveTransport(
      {
        write: (item) => {
          received.push(item);
        },
      },
      { errorRate: 2, sample: 0, windowMs: 60_000 },
    );
    // Math.random() >= sample(0) is always true → all verbose dropped.
    adaptive.write(entry("error one", "error"));
    adaptive.write(entry("error two", "error"));
    adaptive.write(entry("dropped info"));
    expect(received.map((item) => item.message)).toEqual([
      "error one",
      "storm: 2 errors in 60000ms - sampling verbose levels",
      "error two",
    ]);
  });

  test("groups repeated errors into one summary until recovery", async () => {
    const received: LogEntry[] = [];
    const adaptive = new AdaptiveTransport(
      {
        write: (item) => {
          received.push(item);
        },
      },
      { cooldownMs: 30, errorRate: 1, sample: 1, windowMs: 20 },
    );
    // The trigger error is written as-is, the rest are grouped.
    adaptive.write(entry("boom", "error"));
    adaptive.write(entry("boom", "error"));
    adaptive.write(entry("boom", "error"));
    // Recovery: below the rate threshold (errors leave the window)…
    await sleep(60);
    adaptive.write(entry("normal"));
    // …cooldown starts; a second quiet observation completes it.
    await sleep(40);
    adaptive.write(entry("normal"));
    expect(received.map((item) => item.message)).toEqual([
      "storm: 1 errors in 20ms - sampling verbose levels",
      "boom",
      "normal",
      "boom ×2",
      "storm over - full logging resumed",
      "normal",
    ]);
  });

  test("sample keeps a fraction of verbose entries while throttled", () => {
    const received: LogEntry[] = [];
    const adaptive = new AdaptiveTransport(
      {
        write: (item) => {
          received.push(item);
        },
      },
      { errorRate: 1, sample: 1, windowMs: 60_000 },
    );
    adaptive.write(entry("error", "error"));
    adaptive.write(entry("kept info"));
    expect(received.map((item) => item.message)).toContain("kept info");
  });
});