import { describe, expect, test } from "bun:test";

import { registerToken } from "@/index.logger";
import { resolveSettings } from "@/lib/settings.utils";
import { captureConsole } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import { ConsoleTransport } from "@/writer/console.writer";

const entry = (overrides: Partial<LogEntry>): LogEntry => ({
  author: "T",
  context: {},
  level: "info",
  message: "hello",
  timestamp: "2026-08-25T00:00:00.000Z",
  ...overrides,
});

const renderWith = (template: string, target: LogEntry): string => {
  const { outputs, restore } = captureConsole();
  try {
    new ConsoleTransport(
      resolveSettings({
        colors: false,
        format: { template },
        mode: "pretty",
        showAuthor: false,
        showTime: false,
      }),
    ).write(target);
  } finally {
    restore();
  }
  return outputs.join("\n");
};

describe("registerToken", () => {
  test("renders custom tokens from the entry", () => {
    registerToken("rssmb", (e) => String(e.context.rss ?? 0));
    const out = renderWith("[{message}] mem={rssmb}", entry({ context: { rss: 4096 } }));
    expect(out).toContain("mem=4096");
  });

  test("registered tokens win over context keys of the same name", () => {
    registerToken("who", () => "registry");
    const out = renderWith("{who}", entry({ context: { who: "context" }, message: "x" }));
    expect(out).toContain("registry");
  });

  test("re-registering updates the renderer for later entries", () => {
    registerToken("stage", () => "one");
    const first = renderWith("{stage}", entry({ message: "a" }));
    registerToken("stage", () => "two");
    const second = renderWith("{stage}", entry({ message: "b" }));
    expect(first).toContain("one");
    expect(second).toContain("two");
  });

  test("rejects dotted and reserved names", () => {
    expect(() => registerToken("timestamp.x", () => "")).toThrow(/invalid token name/u);
    expect(() => registerToken("message", () => "")).toThrow(/reserved/u);
    expect(() => registerToken("a.b", () => "")).toThrow(/invalid token name/u);
  });

  test("a throwing renderer degrades to a visible marker", () => {
    registerToken("bad", () => {
      throw new Error("nope");
    });
    const out = renderWith("{message} {bad}", entry({ message: "still logs" }));
    expect(out).toContain("still logs");
    expect(out).toContain("[TOKEN ERROR]");
  });
});
