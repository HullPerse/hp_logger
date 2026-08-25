import { describe, expect, test } from "bun:test";

import {
  mergeSettings,
  resolveDefaultMode,
  resolveEnvLevel,
  resolveSettings,
} from "@/lib/settings.utils";

describe("settings", () => {
  test("resolves the documented defaults", () => {
    expect(resolveSettings()).toMatchObject({
      batching: false,
      database: false,
      enabled: true,
      file: false,
      formatContext: "json",
      formatTimestamp: "iso",
      level: "info",
      maxMessageLength: 2000,
      mode: process.stdout.isTTY ? "pretty" : "json",
      redactDepth: 2,
      showAuthor: true,
      showDate: false,
      showLevel: false,
      showTime: true,
      showYear: false,
      tagCase: "upper",
    });
  });

  test.each([
    ["TTY", true, "pretty"],
    ["pipe", false, "json"],
    ["missing TTY information", undefined, "json"],
  ] as const)("uses %s output mode", (_environment, isTTY, expected) => {
    expect(resolveDefaultMode(isTTY)).toBe(expected);
  });

  test("explicit mode overrides the adaptive TTY default", () => {
    expect(resolveSettings({ mode: "pretty" }).mode).toBe("pretty");
    expect(resolveSettings({ mode: "json" }).mode).toBe("json");
  });

  test("merges patches without discarding unrelated settings", () => {
    const base = resolveSettings({
      colors: { info: "cyan" },
      filters: [(entry) => entry.level === "error"],
      level: "debug",
      showAuthor: false,
    });
    const merged = mergeSettings(base, { level: "warn", showLevel: true });

    expect(merged.level).toBe("warn");
    expect(merged.showLevel).toBe(true);
    expect(merged.showAuthor).toBe(false);
    expect(merged.colors).toEqual({ info: "cyan" });
    expect(merged.filters).toBe(base.filters);
  });

  test("allows null redaction settings to survive a merge", () => {
    const merged = mergeSettings(resolveSettings(), { redactKeys: null });
    expect(merged.redactKeys).toBeNull();
  });

  test.each([
    ["trace", "trace"],
    ["debug", "debug"],
    ["fatal", "fatal"],
    ["unknown", "info"],
    [undefined, "info"],
  ] as const)("resolves LOG_LEVEL %s to %s", (configured, expected) => {
    expect(resolveEnvLevel(configured === undefined ? {} : { LOG_LEVEL: configured })).toBe(
      expected,
    );
  });
});
