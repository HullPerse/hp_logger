import { describe, expect, test } from "bun:test";

import { formatContext } from "@/format/context.format";
import { formatDuration } from "@/format/duration.format";
import { formatEntry } from "@/format/entry.format";
import { caseTag } from "@/format/tag.format";
import type { LogEntry } from "@/types/logger";

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
    expect(formatContext({ method: "GET", status: 200 }, "kv")).toBe(
      ' method="GET" status=200',
    );
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
