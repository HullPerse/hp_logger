import { describe, expect, test } from "bun:test";

import { drawBox } from "../../format/box.format.js";
import { resolveSettings } from "../settings.utils.js";
import { captureConsole } from "./test.transport.js";
import type { LogEntry } from "../../types/logger.js";
import { ConsoleTransport } from "../../writer/console.writer.js";

const entry = (overrides: Partial<LogEntry>): LogEntry => ({
  author: "api",
  context: {},
  level: "info",
  message: "hello",
  timestamp: "2026-08-25T10:20:30",
  ...overrides,
});

const prettySettings = (box: Parameters<typeof drawBox>[1] & Record<string, unknown>) =>
  resolveSettings({
    box: box as never,
    colors: false,
    mode: "pretty",
    showAuthor: false,
    showTime: false,
  });

describe("drawBox", () => {
  test("frames lines with a uniform visible width", () => {
    const lines = drawBox(["one", "three"]);
    expect(lines).toEqual(["+-------+", "| one   |", "| three |", "+-------+"]);
  });

  test("embeds the title in the top border", () => {
    const [top] = drawBox(["x"], { title: "metrics" });
    expect(top).toBe("+-- metrics +");
  });

  test("honors a minimum width floor", () => {
    const lines = drawBox(["ab"], { width: 8 });
    expect(lines[0]).toBe("+----------+");
    expect(lines[1]).toBe("| ab       |");
  });

  test("ANSI codes in content do not skew padding", () => {
    const colored = "\u001B[31mab\u001B[39m";
    const lines = drawBox([colored]);
    expect(lines).toEqual(["+----+", `| ${colored} |`, "+----+"]);
  });
});

describe("box rendering in pretty console output", () => {
  test("error cause chains get framed when box.error is set", () => {
    const { outputs, restore } = captureConsole();
    try {
      const transport = new ConsoleTransport(prettySettings({ error: true }));
      transport.write(
        entry({
          context: { error: new Error("db down") },
          level: "error",
          message: "boom",
        }),
      );
    } finally {
      restore();
    }
    const out = outputs.join("\n");
    // Chain lines: "✗ Error: db down" (16 visible chars) plus the empty rest
    // line; borders carry width+2 dashes ("+-" ... "-+").
    expect(out).toContain(`+${"-".repeat(18)}+`);
    expect(out).toContain("| ✗ Error: db down |");
    expect(out.startsWith("|")).toBe(false);
  });

  test("fatal bodies get framed when box.fatal is set", () => {
    const { outputs, restore } = captureConsole();
    try {
      const transport = new ConsoleTransport(prettySettings({ fatal: true }));
      transport.write(entry({ context: { code: 7 }, level: "fatal", message: "died" }));
    } finally {
      restore();
    }
    const out = outputs.join("\n");
    expect(out).toContain("| died");
    expect(out).toContain('"code":7');
    expect(out).toContain("+");
  });

  test("storm notices get framed when box.storm is set", () => {
    const { outputs, restore } = captureConsole();
    try {
      const transport = new ConsoleTransport(prettySettings({ storm: true }));
      transport.write(entry({ author: "adaptive", message: "storm: 20 errors in 10000ms" }));
    } finally {
      restore();
    }
    const out = outputs.join("\n");
    expect(out).toContain("| storm: 20 errors in 10000ms |");
  });

  test("boxes stay off by default and do not leak into json mode", () => {
    const { outputs, restore } = captureConsole();
    try {
      new ConsoleTransport(
        resolveSettings({ colors: false, mode: "pretty", showAuthor: false, showTime: false }),
      ).write(entry({ level: "fatal", message: "plain" }));
      new ConsoleTransport(
        resolveSettings({
          box: { fatal: true },
          colors: false,
          mode: "json",
          showAuthor: false,
          showTime: false,
        }),
      ).write(entry({ level: "fatal", message: "jsoned" }));
    } finally {
      restore();
    }
    const out = outputs.join("\n");
    expect(out).not.toContain("+--");
    expect(out).not.toContain("| plain");
  });
});
