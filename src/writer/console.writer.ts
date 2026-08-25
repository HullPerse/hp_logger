import type { sliceAnsi, wrapAnsi } from "bun";

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
} from "../config/attention.config";
import { DEFAULT_LEVEL_COLORS, LEVEL_EMOJIS } from "../config/colors.config";
import { LEVEL_NAMES } from "../config/levels.config";
import { drawBox } from "../format/box.format";
import { colorizeJsonString } from "../format/colorize.format";
import { formatContext } from "../format/context.format";
import { formatDuration } from "../format/duration.format";
import { formatPrettyErrorBlock } from "../format/error.format";
import { caseTag } from "../format/tag.format";
import { renderTemplateSettings } from "../format/template.format";
import { applyColor } from "../lib/color.utils";
import { stripControlCharacters } from "../lib/json.utils";
import type { ColorName, LogEntry, LogLevel, ResolvedSettings, TagCase } from "../types/logger";
import type { Transport } from "../types/transport";

type LevelTagMap = Record<LogLevel, string>;
type LevelColorMap = Record<LogLevel, ColorName | false | undefined>;

/**
 * Route a rendered line to the console method matching its level.
 * JSON output keeps trace/debug/info on console.log (legacy); pretty
 * output sends debug/trace to console.debug.
 */
// Re-entrancy counter: console capture (console.api) routes console calls
// into a logger, and this counter tells it when a call comes from the
// logger's own write - those print natively instead of re-entering.
let activeWrites = 0;

/** True while the logger itself is writing, so console capture can step aside. */
export const isLoggerWriting = (): boolean => activeWrites > 0;

const consoleWrite = (level: LogLevel, output: string, debugTraceToConsoleDebug = true): void => {
  activeWrites += 1;
  try {
    if (level === "error" || level === "fatal") console.error(output);
    else if (level === "warn") console.warn(output);
    else if (debugTraceToConsoleDebug && (level === "debug" || level === "trace"))
      console.debug(output);
    else console.log(output);
  } finally {
    activeWrites -= 1;
  }
};

const writeTracked = (level: LogLevel, output: string, debugTraceToConsoleDebug = true): void => {
  consoleWrite(level, output, debugTraceToConsoleDebug);
};

/** Minimal stdout shape for attention sequences; test fakes fit too. */
interface AttentionStream {
  readonly isTTY?: boolean;
  write: (chunk: string) => unknown;
}

/** OSC 9;4 taskbar progress subcommand frame. */
const progressSequence = (state: string): string => `${PROGRESS_PREFIX}${state}${PROGRESS_SUFFIX}`;

const defaultStream = (): AttentionStream | null => {
  if (typeof process === "undefined") return null;
  return process.stdout;
};

export class ConsoleTransport implements Transport {
  private readonly levelColors: LevelColorMap;
  private readonly levelTags: LevelTagMap;
  private readonly settings: ResolvedSettings;
  private readonly tagCase: TagCase;
  private readonly startedAt: number;
  private readonly writeCompiled: (entry: LogEntry) => void;
  private authorTagCache: { raw: string; tag: string } | null = null;
  private readonly attention: ResolvedSettings["attention"];
  private readonly out: AttentionStream | null;
  private fatalSeen = false;
  private stormActive = false;
  private tasksOpen = 0;

  constructor(settings: ResolvedSettings, out?: AttentionStream | null) {
    this.startedAt = performance.now();
    this.settings = settings;
    this.tagCase = settings.tagCase;
    this.attention = settings.attention;
    this.out = out === undefined ? defaultStream() : out;
    this.levelColors = Object.fromEntries(
      LEVEL_NAMES.map((level) => [level, this.colorFor(level)]),
    ) as LevelColorMap;
    this.levelTags = Object.fromEntries(
      LEVEL_NAMES.map((level) => [
        level,
        applyColor(this.levelColors[level], `[${caseTag(level, this.tagCase)}]`),
      ]),
    ) as LevelTagMap;
    this.writeCompiled =
      settings.mode === "json" ? ConsoleTransport.writeJson : (entry) => this.writePretty(entry);
  }

  write(entry: LogEntry): void {
    this.observe(entry);
    this.writeCompiled(entry);
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) {
      this.observe(entry);
      this.writeCompiled(entry);
    }
  }

  /**
   * Terminal attention reactions, observed before rendering: bell on the
   * first fatal or a storm start, storm title, taskbar progress for open
   * tasks. Storm detection reads the status key that AdaptiveTransport puts
   * on its notices; task lifecycle reads the status/task keys written by
   * logger.task(). One falsy check is the whole cost when attention is off.
   */
  private observe(entry: LogEntry): void {
    const { attention } = this;
    if (attention === false) return;

    if (attention.bell && entry.level === "fatal" && !this.fatalSeen) {
      this.fatalSeen = true;
      this.emit(BELL_SEQUENCE);
    }
    if (attention.progress) this.observeTask(entry);

    if (!attention.title && !attention.bell) return;
    const { status } = entry.context;
    if (entry.author !== "adaptive") return;
    if (status === "storm-started") {
      this.stormActive = true;
      if (attention.bell) this.emit(BELL_SEQUENCE);
      if (attention.title) this.emit(`${TITLE_PREFIX}${STORM_TITLE}${TITLE_SUFFIX}`);
    } else if (status === "storm-ended" && this.stormActive) {
      this.stormActive = false;
      // The original title cannot be read back synchronously, so storm end
      // clears it and terminals fall back to their default label.
      if (attention.title) this.emit(`${TITLE_PREFIX}${TITLE_SUFFIX}`);
    }
  }

  /** Taskbar progress bookkeeping over the task lifecycle entries. */
  private observeTask(entry: LogEntry): void {
    if (typeof entry.context.task !== "string") return;
    const { status } = entry.context;
    if (status === "started") {
      this.tasksOpen += 1;
      if (this.tasksOpen === 1) this.emit(progressSequence(PROGRESS_INDETERMINATE));
      return;
    }
    if (status !== "done" && status !== "failed") return;
    if (this.tasksOpen === 0) return;
    this.tasksOpen -= 1;
    if (this.tasksOpen === 0) {
      this.emit(progressSequence(status === "failed" ? PROGRESS_ERROR : PROGRESS_REMOVE));
    }
  }

  /** Write one attention sequence straight to the terminal stream, TTY-gated. */
  private emit(sequence: string): void {
    if (this.out?.isTTY !== true) return;
    this.out.write(sequence);
  }

  private writePretty(entry: LogEntry): void {
    const { format } = this.settings;
    let output: string;
    if (format === undefined) {
      output = this.renderDefault(entry);
    } else if (typeof format === "function") {
      output = this.finalize(format(entry));
    } else {
      output = renderTemplateSettings(format, entry, {
        authorName: (author) => this.authorName(author),
        colorize: true,
        contextFormat: this.settings.formatContext,
        elapsedMs: () => performance.now() - this.startedAt,
        levelColor: (level) => this.levelColors[level],
        stripControl: this.settings.stripControl,
        tagCase: this.tagCase,
      });
    }
    writeTracked(entry.level, output, true);
  }

  /** Cased author text, memoized: authors repeat across entries. */
  private authorName(raw: string): string {
    if (this.authorTagCache?.raw === raw) return this.authorTagCache.tag;
    const tag = caseTag(raw, this.tagCase);
    this.authorTagCache = { raw, tag };
    return tag;
  }

  /** Leading tag block of the default renderer: indent, time, level, author. */
  private renderTags(entry: LogEntry): string {
    const tag = (value: string): string => applyColor(this.levelColors[entry.level], `[${value}]`);
    let output = "";

    const { group } = entry.context;
    if (typeof group === "string" && group !== "") {
      output += "  ".repeat(Math.max(0, group.split(".").length - 1));
    }

    const time = entry.timestamp.slice(11, 19);
    const date = entry.timestamp.slice(5, 10);
    const year = entry.timestamp.slice(0, 4);

    if (this.settings.showTime) output += `${tag(time)} `;
    if (this.settings.showDate) output += `${tag(date)} `;
    if (this.settings.showYear) output += `${tag(year)} `;
    if (this.settings.showElapsed) {
      const elapsedMs = Math.round(performance.now() - this.startedAt);
      output += `${tag(`+${formatDuration(elapsedMs)}`)} `;
    }
    if (this.settings.emoji) output += `${tag(LEVEL_EMOJIS[entry.level])} `;
    if (this.settings.showLevel) output += `${this.levelTags[entry.level]} `;
    if (this.settings.showAuthor) output += `${tag(this.authorName(entry.author))} `;
    return output;
  }

  private renderDefault(entry: LogEntry): string {
    const levelColor = this.levelColors[entry.level];
    let output = this.renderTags(entry);

    // stripControl sanitizes only user-controlled text (message and
    // context) before tags/colors are applied, so our own ANSI codes and
    // formatting survive while hostile terminal escapes from logged data
    // are removed.
    const message =
      this.settings.stripControl && entry.message
        ? stripControlCharacters(entry.message)
        : entry.message;
    const box = this.settings.box === false ? undefined : this.settings.box;
    // The pipeline attaches callSite only to error/fatal entries; presence alone gates rendering.
    const site = entry.callSite ? ` ${this.callSiteLink(entry.callSite)}` : "";
    const errorBlock = formatPrettyErrorBlock(entry.context);
    if (errorBlock !== null) {
      // The block carries no styling of our own, so a full pass is safe.
      const block = this.settings.stripControl ? stripControlCharacters(errorBlock) : errorBlock;
      if (box?.error === true) {
        const framed = drawBox(block.split("\n"), {
          color: levelColor,
          width: this.boxWidth(),
        });
        return this.finalize(`${output}${message}\n${framed.join("\n")}${site}`);
      }
      output += `${message}${site}\n${block}`;
      return this.finalize(output);
    }
    if (box?.storm === true && entry.author === "adaptive") {
      const framed = drawBox(message.split("\n"), { color: levelColor, width: this.boxWidth() });
      return this.finalize(`${output.trimEnd()}\n${framed.join("\n")}`);
    }
    const contextStr = this.renderContext(entry);
    if (box?.fatal === true && entry.level === "fatal") {
      const framed = drawBox(`${message}${contextStr}`.split("\n"), {
        color: levelColor,
        width: this.boxWidth(),
      });
      return this.finalize(`${output.trimEnd()}\n${framed.join("\n")}${site}`);
    }
    output += `${message}${contextStr}${site}`;

    return this.finalize(output);
  }

  /** Inner width available for box content when prettyWrap is set. */
  private boxWidth(): number | undefined {
    return typeof this.settings.prettyWrap === "number"
      ? Math.max(1, this.settings.prettyWrap - 4)
      : undefined;
  }

  /**
   * Terminal hyperlink for the entry's captured call site. The OSC 8
   * sequence is logger-generated (never logged data), so stripControl
   * deliberately does not touch it.
   */
  private callSiteLink(raw: string): string {
    const posix = raw.replaceAll("\\", "/");
    const href = `file://${posix.startsWith("/") ? "" : "/"}${encodeURI(posix)}`;
    const styled = this.settings.colors === false ? raw : applyColor("gray", raw);
    return `\u001B]8;;${href}\u0007${styled}\u001B]8;;\u0007`;
  }

  /** Context text with strip/color passes applied so our own ANSI codes survive. */
  private renderContext(entry: LogEntry): string {
    const raw = formatContext(entry.context, this.settings.formatContext);
    if (this.settings.colorizeContext && this.settings.formatContext === "json") {
      return colorizeJsonString(stripControlCharacters(raw));
    }
    return this.settings.stripControl ? stripControlCharacters(raw) : raw;
  }

  /** Apply prettyTruncate/prettyWrap to a rendered line, ANSI-safe on Bun. */
  private finalize(line: string): string {
    const { prettyTruncate, prettyWrap } = this.settings;
    if (prettyTruncate === false && prettyWrap === false) return line;

    const bunRuntime = (globalThis as Record<string, unknown>).Bun as
      | { sliceAnsi?: typeof sliceAnsi; wrapAnsi?: typeof wrapAnsi }
      | undefined;
    if (bunRuntime?.sliceAnsi && bunRuntime.wrapAnsi) {
      let result = line;
      if (prettyTruncate !== false) {
        result = bunRuntime.sliceAnsi(result, 0, prettyTruncate, "…");
      }
      if (prettyWrap !== false) {
        result = bunRuntime.wrapAnsi(result, prettyWrap, { wordWrap: true });
      }
      return result;
    }

    let result = line;
    if (prettyTruncate !== false) {
      result = result.length > prettyTruncate ? `${result.slice(0, prettyTruncate - 1)}…` : result;
    }
    return result;
  }

  private colorFor(level: LogLevel): ColorName | false | undefined {
    if (this.settings.colors === false) return false;
    return this.settings.colors[level] ?? DEFAULT_LEVEL_COLORS[level];
  }

  private static writeJson(entry: LogEntry): void {
    const output = JSON.stringify({
      author: entry.author,
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
      ...(entry.v === undefined ? {} : { v: entry.v }),
      ...(entry.spanPath ? { spanPath: entry.spanPath } : {}),
      ...(entry.callSite ? { callSite: entry.callSite } : {}),
      ...entry.context,
    });
    writeTracked(entry.level, output, false);
  }
}
