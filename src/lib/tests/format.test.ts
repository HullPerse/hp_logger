import { describe, expect, test } from "bun:test";

import { colorizeJsonString } from "../../format/colorize.format.js";
import { formatContext } from "../../format/context.format.js";
import { formatDuration } from "../../format/duration.format.js";
import { formatEntry } from "../../format/entry.format.js";
import { formatPrettyErrorBlock } from "../../format/error.format.js";
import { renderTable } from "../../format/table.format.js";
import { caseTag } from "../../format/tag.format.js";
import { safeStringify, stripControlCharacters } from "../json.utils.js";
import type { LogEntry } from "../../types/logger.js";

const entry: LogEntry = {
  author: "api",
  context: { method: "GET", status: 200 },
  level: "info",
  message: "request finished",
  timestamp: "2026-08-24 10:11:12",
};

describe("formatDuration", () => {
  test.each([
    [0, "0ms"],
    [999.4, "999ms"],
    [1000, "1.00s"],
    [2500, "2.50s"],
  ])("formats %s milliseconds as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});

describe("formatContext", () => {
  test("omits an empty context", () => {
    expect(formatContext({}, "json")).toBe("");
    expect(formatContext({}, "kv")).toBe("");
  });

  test("renders JSON context without changing values", () => {
    expect(formatContext({ method: "GET", status: 200 }, "json")).toBe(
      ' {"method":"GET","status":200}',
    );
  });

  test("renders key-value context with quoted strings", () => {
    expect(formatContext({ method: "GET", status: 200 }, "kv")).toBe(' method="GET" status=200');
  });
});

describe("formatEntry", () => {
  test("renders JSON as a structured line", () => {
    expect(formatEntry(entry, "json")).toBe(JSON.stringify(entry));
  });

  test("renders pretty output with configured tag case and context format", () => {
    expect(formatEntry(entry, "pretty", "kv", undefined, "lower")).toBe(
      '[2026-08-24 10:11:12] [api] [info] request finished method="GET" status=200',
    );
  });

  test("uses a custom formatter instead of the default pretty renderer", () => {
    expect(formatEntry(entry, "pretty", "json", (value) => `${value.level}:${value.message}`)).toBe(
      "info:request finished",
    );
  });

  test("strips control characters from pretty output when enabled", () => {
    // The ESC byte is removed; the leftover `[2J` text is inert without it.
    const hostile = { ...entry, message: "done\u001B[2J" };
    expect(formatEntry(hostile, "pretty", "json", undefined, "upper", true)).toBe(
      '[2026-08-24 10:11:12] [API] [INFO] done[2J {"method":"GET","status":200}',
    );
    expect(formatEntry(hostile, "pretty", "json")).toBe(
      '[2026-08-24 10:11:12] [API] [INFO] done\u001B[2J {"method":"GET","status":200}',
    );
  });

  test("strips control characters from custom formatter output when enabled", () => {
    expect(
      formatEntry(entry, "pretty", "json", (value) => `${value.message}\u0000`, "upper", true),
    ).toBe("request finished");
  });
});

describe("stripControlCharacters", () => {
  test("removes the ESC byte, NUL and DEL but keeps tab, newline and CR", () => {
    expect(stripControlCharacters("a\u001B[2Jb\u0000c\u007F")).toBe("a[2Jbc");
    expect(stripControlCharacters("line1\nline2\ttab\r\n")).toBe("line1\nline2\ttab\r\n");
  });

  test("leaves printable text untouched", () => {
    expect(stripControlCharacters("hello world ✓")).toBe("hello world ✓");
  });
});

describe("safeStringify", () => {
  test("falls back without throwing on circular values", () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    expect(safeStringify(circular)).toBe("[unserializable]");
  });

  test("serializes plain values normally", () => {
    expect(safeStringify({ ok: true })).toBe('{"ok":true}');
  });
});

describe("colorizeJsonString", () => {
  test("colors keys, strings, numbers and literals", () => {
    const colored = colorizeJsonString('{"method":"GET","status":200,"ok":true}');
    expect(colored).toContain('\u001B[36m"method"\u001B[39m');
    expect(colored).toContain('\u001B[32m"GET"\u001B[39m');
    expect(colored).toContain("\u001B[33m200\u001B[39m");
    expect(colored).toContain("\u001B[35mtrue\u001B[39m");
  });
});

describe("renderTable", () => {
  test("renders an aligned table with a header", () => {
    const table = renderTable([
      { id: 1, name: "aa" },
      { id: 22, name: "b" },
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[1]).toContain("1");
    expect(lines[2]).toContain("22");
  });

  test("returns an empty string for no rows", () => {
    expect(renderTable([])).toBe("");
  });
});

describe("formatPrettyErrorBlock", () => {
  test("renders the error chain and the remaining context", () => {
    const block = formatPrettyErrorBlock({
      error: {
        cause: { message: "timed out", name: "ConnectionTimeout" },
        message: "down",
        name: "DatabaseError",
      },
      query: "SELECT 1",
    });
    expect(block).toBe(
      '✗ DatabaseError: down\n  ✗ ConnectionTimeout: timed out\n  query="SELECT 1"',
    );
  });

  test("returns null without an error-like value", () => {
    expect(formatPrettyErrorBlock({ method: "GET" })).toBeNull();
  });
});

describe("caseTag", () => {
  test.each([
    ["MiXeD", "upper", "MIXED"],
    ["MiXeD", "lower", "mixed"],
    ["MiXeD", "none", "MiXeD"],
  ] as const)("applies %s tag case", (value, tagCase, expected) => {
    expect(caseTag(value, tagCase)).toBe(expected);
  });
});
