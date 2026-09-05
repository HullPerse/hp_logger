import { describe, expect, test } from "bun:test";

import { formatEntry } from "../../format/entry.format.js";
import { resolveCaller } from "../callsite.utils.js";
import { resolveSettings } from "../settings.utils.js";
import { captureConsole, captureLogger } from "./test.transport.js";
import type { LogEntry } from "../../types/logger.js";
import { ConsoleTransport } from "../../writer/console.writer.js";

const lastEntry = (entries: LogEntry[]): LogEntry => entries.at(-1) as LogEntry;

const siteEntry = (): LogEntry => ({
  author: "T",
  callSite: "/app/src/x.ts:9:3",
  context: {},
  level: "error",
  message: "boom",
  timestamp: "2026-08-25T00:00:00.000Z",
});

// Synthetic internal frames use this real prefix so the filter treats them
// as logger frames on any machine.
const internalFrame = (name: string, line: number): string =>
  `    at ${name} (${import.meta.dir}/${name}.ts:${line}:5)`;

describe("callSite resolution", () => {
  test("picks the first frame outside the package", () => {
    const stack = [
      "Error: boom",
      internalFrame("captureCaller", 20),
      internalFrame("writeEntry", 44),
      "    at handleUpload (/srv/app/src/routes/upload.ts:84:15)",
    ].join("\n");
    expect(resolveCaller(stack)).toBe("/srv/app/src/routes/upload.ts:84:15");
  });

  test("converts file:// URLs to plain paths", () => {
    const stack = "    at null (<anonymous>)\n    at file:///srv/app/mod.js:12:3";
    expect(resolveCaller(stack)).toContain("srv/app/mod.js:12:3");
  });

  test("returns undefined when every frame is internal", () => {
    const stack = ["Error: x", internalFrame("a", 1), internalFrame("b", 2)].join("\n");
    expect(resolveCaller(stack)).toBeUndefined();
  });
});

describe("callSite setting", () => {
  test("in-repo callers are package frames, so the field stays absent", () => {
    // Documented behavior: development from inside this repository filters
    // every frame; consumers importing the published package get real sites.
    const { entries, logger } = captureLogger({ callSite: true });
    logger.error("in repo");
    const entry = lastEntry(entries);
    expect(entry.message).toBe("in repo");
    expect(entry.callSite).toBeUndefined();
  });

  test("info entries never carry it, even when enabled", () => {
    const { entries, logger } = captureLogger({ callSite: true });
    logger.info("quiet");
    expect(lastEntry(entries).callSite).toBeUndefined();
  });

  test("default off keeps the field absent on errors", () => {
    const { entries, logger } = captureLogger({});
    logger.error("plain");
    expect(lastEntry(entries).callSite).toBeUndefined();
  });
});

describe("callSite rendering", () => {
  test("json output includes the raw location", () => {
    const line = formatEntry(siteEntry(), "json");
    expect(line).toContain('"callSite":"/app/src/x.ts:9:3"');
  });

  test("pretty output wraps it in an OSC 8 hyperlink", () => {
    const { outputs, restore } = captureConsole();
    try {
      new ConsoleTransport(
        resolveSettings({
          colors: false,
          mode: "pretty",
          showAuthor: false,
          showTime: false,
        }),
      ).write(siteEntry());
    } finally {
      restore();
    }
    const out = outputs.join("\n");
    expect(out).toContain(
      "\u001B]8;;file:///app/src/x.ts:9:3\u0007/app/src/x.ts:9:3\u001B]8;;\u0007",
    );
  });
});
