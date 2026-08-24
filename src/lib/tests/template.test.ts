import { describe, expect, test } from "bun:test";

import { SPINNER_FRAMES, TASK_GLYPHS } from "@/config/colors.config";
import { parseTemplate, renderTemplate } from "@/format/template.format";
import type { LogEntry, LogLevel } from "@/types/logger";

const entry: LogEntry = {
  author: "api",
  context: {
    group: "request.db",
    requestId: "abc-42",
    status: "done",
    task: "uploading",
  },
  level: "info",
  message: "saved",
  timestamp: "2026-08-24T12:34:56.789Z",
};

const env = (overrides: Record<string, unknown> = {}) => ({
  authorName: (author: string) => author.toUpperCase(),
  colorize: false,
  contextFormat: "json" as const,
  elapsedMs: () => 1500,
  levelColor: (level: LogLevel) => (level === "info" ? ("blue" as const) : undefined),
  stripControl: false,
  tagCase: "upper" as const,
  ...overrides,
});

describe("parseTemplate", () => {
  test("splits literals from tokens and keeps escapes", () => {
    const parts = parseTemplate("a\\{b} {message} tail");
    expect(parts).toEqual([
      { color: undefined, kind: "literal", value: "a{b} " },
      { color: undefined, kind: "token", levelColored: false, value: "message" },
      { color: undefined, kind: "literal", value: " tail" },
    ]);
  });

  test("reads explicit token colors and colored literal spans", () => {
    const parts = parseTemplate("{message:red} {:green}ok{:/}");
    expect(parts[0]).toMatchObject({ color: "red", kind: "token", value: "message" });
    expect(parts[2]).toMatchObject({ color: "green", kind: "literal", value: "ok" });
  });
});

describe("renderTemplate tokens", () => {
  test("renders base fields with author casing", () => {
    const parts = parseTemplate("[{author}] {level}: {message}");
    expect(renderTemplate(parts, entry, env())).toBe("[API] info: saved");
  });

  test("renders timestamp parts including weekday", () => {
    const parts = parseTemplate(
      "{timestamp.year}-{timestamp.month}-{timestamp.day} {timestamp.time}.{timestamp.ms} {timestamp.weekday}",
    );
    const rendered = renderTemplate(parts, entry, env());
    expect(rendered).toMatch(/^2026-08-24 12:34:56\.789 \w{3}$/u);
  });

  test("renders tag-shaped and elapsed tokens", () => {
    const parts = parseTemplate("{level.tag} [{elapsed}]");
    expect(renderTemplate(parts, entry, env())).toBe("[INFO] [+1.50s]");
  });

  test("renders group indent as two spaces per dot level", () => {
    const parts = parseTemplate("{group.indent}{message}");
    expect(renderTemplate(parts, entry, env())).toBe("  saved");
  });

  test("any context key doubles as a token", () => {
    const parts = parseTemplate("[{requestId}] {task}");
    expect(renderTemplate(parts, entry, env())).toBe("[abc-42] uploading");
  });

  test("task.frame cycles spinner frames by the frame counter", () => {
    const parts = parseTemplate("{task.frame} {message}");
    for (let i = 0; i < SPINNER_FRAMES.length + 2; i += 1) {
      const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length] as string;
      const rendered = renderTemplate(parts, { ...entry, context: { frame: i } }, env());
      expect(rendered.startsWith(frame)).toBe(true);
      expect(rendered.endsWith("saved")).toBe(true);
    }
  });

  test("task.glyph maps the task status", () => {
    const parts = parseTemplate("{task.glyph}{message}");
    for (const [status, glyph] of Object.entries(TASK_GLYPHS)) {
      expect(renderTemplate(parts, { ...entry, context: { status } }, env())).toBe(`${glyph}saved`);
    }
    const noStatus = renderTemplate(parts, { ...entry, context: {} }, env());
    expect(noStatus).toBe("saved");
  });

  test("explicit colors wrap output in ANSI when colorize is on", () => {
    const colored = renderTemplate(parseTemplate("{message:red}"), entry, env({ colorize: true }));
    expect(colored).not.toBe("saved");
    expect(colored).toContain("saved");

    const plain = renderTemplate(parseTemplate("{message:red}"), entry, env());
    expect(plain).toBe("saved");

    const span = renderTemplate(parseTemplate("{:green}ok{:/}"), entry, env({ colorize: true }));
    expect(span).not.toBe("ok");
    expect(span).toContain("ok");

    // Level-colored tags inherit the level color only in color mode.
    const inherited = renderTemplate(parseTemplate("[{level.tag}]"), entry, env({ colorize: true }));
    expect(inherited).not.toBe("[INFO]");
  });

  test("unknown dotted tokens stay literal and render empty-safe", () => {
    const parts = parseTemplate("x {nope.missing} y");
    expect(renderTemplate(parts, entry, env())).toBe("x {nope.missing} y");
  });

  test("missing values collapse to empty strings", () => {
    const parts = parseTemplate("a{retry.attempt}b");
    expect(renderTemplate(parts, entry, env())).toBe("ab");
  });
});
