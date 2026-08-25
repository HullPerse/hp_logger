import { describe, expect, test } from "bun:test";

import {
  BELL_SEQUENCE,
  PROGRESS_ERROR,
  PROGRESS_INDETERMINATE,
  PROGRESS_PREFIX,
  PROGRESS_REMOVE,
  PROGRESS_SUFFIX,
  STORM_TITLE,
  TITLE_PREFIX,
  TITLE_SUFFIX,
} from "@/config/attention.config";
import { mergeSettings, resolveSettings } from "@/lib/settings.utils";
import type { LogEntry } from "@/types/logger";
import { ConsoleTransport } from "@/writer/console.writer";

const entry = (overrides: Partial<LogEntry>): LogEntry => ({
  author: "api",
  context: {},
  level: "info",
  message: "hello",
  timestamp: "2026-08-25T10:20:30",
  ...overrides,
});

interface FakeStream {
  chunks: string[];
  isTTY: boolean;
  write: (chunk: string) => void;
}

const fakeStream = (isTTY = true): FakeStream => ({
  chunks: [],
  isTTY,
  write(chunk) {
    this.chunks.push(chunk);
  },
});

const attentionSettings = (
  attention: Record<string, unknown>,
  mode: "json" | "pretty" = "pretty",
) =>
  resolveSettings({
    attention: attention as never,
    colors: false,
    mode,
    showAuthor: false,
    showTime: false,
  });

const progressSequence = (state: string): string => `${PROGRESS_PREFIX}${state}${PROGRESS_SUFFIX}`;

const stormStart = (): LogEntry =>
  entry({
    author: "adaptive",
    context: { errors: 21, status: "storm-started" },
    level: "warn",
    message: "storm: 21 errors in 10000ms - sampling verbose levels",
  });

const stormEnd = (): LogEntry =>
  entry({
    author: "adaptive",
    context: { status: "storm-ended" },
    level: "info",
    message: "storm over - full logging resumed",
  });

const taskEntry = (status: string): LogEntry =>
  entry({ context: { status, task: "upload" }, level: "debug", message: `upload ${status}` });

describe("console attention emission", () => {
  test("emits nothing by default even for fatal entries and storm notices", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(
      resolveSettings({ colors: false, mode: "pretty" }),
      stream,
    );
    transport.write(entry({ level: "fatal", message: "dead" }));
    transport.write(stormStart());
    transport.write(taskEntry("started"));
    expect(stream.chunks).toEqual([]);
  });

  test("stays silent when the output stream is not a TTY", () => {
    const stream = fakeStream(false);
    const transport = new ConsoleTransport(attentionSettings({ bell: true }), stream);
    transport.write(entry({ level: "fatal", message: "dead" }));
    transport.write(stormStart());
    expect(stream.chunks).toEqual([]);
  });

  test("rings the bell on the first fatal entry only", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(attentionSettings({ bell: true }), stream);
    transport.write(entry({ level: "fatal", message: "one" }));
    transport.write(entry({ level: "fatal", message: "two" }));
    expect(stream.chunks).toEqual([BELL_SEQUENCE]);
  });

  test("bell and title fire on storm start, title clears on storm end without a bell", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(attentionSettings({ bell: true, title: true }), stream);
    transport.write(stormStart());
    transport.write(stormEnd());
    // A second end notice must not re-clear.
    transport.write(stormEnd());
    expect(stream.chunks).toEqual([
      BELL_SEQUENCE,
      `${TITLE_PREFIX}${STORM_TITLE}${TITLE_SUFFIX}`,
      `${TITLE_PREFIX}${TITLE_SUFFIX}`,
    ]);
  });

  test("taskbar progress mirrors open tasks and ends in the error state on failure", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(attentionSettings({ progress: true }), stream);
    transport.write(taskEntry("started"));
    // A second concurrent task keeps the progress running.
    transport.write(taskEntry("started"));
    transport.write(taskEntry("done"));
    transport.write(taskEntry("failed"));
    expect(stream.chunks).toEqual([
      progressSequence(PROGRESS_INDETERMINATE),
      progressSequence(PROGRESS_ERROR),
    ]);
  });

  test("taskbar progress clears when the last open task succeeds", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(attentionSettings({ progress: true }), stream);
    transport.write(taskEntry("started"));
    transport.write(taskEntry("done"));
    expect(stream.chunks).toEqual([
      progressSequence(PROGRESS_INDETERMINATE),
      progressSequence(PROGRESS_REMOVE),
    ]);
  });

  test("works outside pretty mode: json entries still drive attention", () => {
    const stream = fakeStream();
    const transport = new ConsoleTransport(attentionSettings({ bell: true }, "json"), stream);
    transport.write(entry({ level: "fatal", message: "dead" }));
    expect(stream.chunks).toEqual([BELL_SEQUENCE]);
  });
});

describe("attention settings resolution", () => {
  test("defaults to false and fills partial objects with defaults", () => {
    expect(resolveSettings().attention).toBe(false);
    expect(resolveSettings({ attention: {} }).attention).toEqual({
      bell: false,
      progress: false,
      title: false,
    });
    expect(resolveSettings({ attention: { bell: true } }).attention).toEqual({
      bell: true,
      progress: false,
      title: false,
    });
  });

  test("merge folds a patch over the base and resets everything on false", () => {
    const base = resolveSettings({ attention: { bell: true, title: true } });
    expect(mergeSettings(base, { attention: { progress: true } }).attention).toEqual({
      bell: true,
      progress: true,
      title: true,
    });
    expect(mergeSettings(base, { attention: false }).attention).toBe(false);
  });
});
