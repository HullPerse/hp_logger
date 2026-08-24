import type { sliceAnsi, wrapAnsi } from "bun";

import { DEFAULT_LEVEL_COLORS } from "../config/colors.config";
import { LEVEL_NAMES } from "../config/levels.config";
import { formatContext } from "../format/context.format";
import { caseTag } from "../format/tag.format";
import { applyColor } from "../lib/color.utils";
import type { ColorName, LogEntry, LogLevel, ResolvedSettings, TagCase } from "../types/logger";
import type { Transport } from "../types/transport";

type LevelTagMap = Record<LogLevel, string>;
type LevelColorMap = Record<LogLevel, ColorName | false | undefined>;

/**
 * Route a rendered line to the console method matching its level.
 * JSON output keeps trace/debug/info on console.log (legacy); pretty
 * output sends debug/trace to console.debug.
 */
const consoleWrite = (level: LogLevel, output: string, debugTraceToConsoleDebug = true): void => {
  if (level === "error" || level === "fatal") console.error(output);
  else if (level === "warn") console.warn(output);
  else if (debugTraceToConsoleDebug && (level === "debug" || level === "trace"))
    console.debug(output);
  else console.log(output);
};

export class ConsoleTransport implements Transport {
  private readonly levelColors: LevelColorMap;
  private readonly levelTags: LevelTagMap;
  private readonly settings: ResolvedSettings;
  private readonly tagCase: TagCase;
  private readonly writeCompiled: (entry: LogEntry) => void;
  private authorTagCache: { raw: string; tag: string } | null = null;

  constructor(settings: ResolvedSettings) {
    this.settings = settings;
    this.tagCase = settings.tagCase;
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
      settings.mode === "json"
        ? ConsoleTransport.writeJson
        : (entry) => this.writePretty(entry);
  }

  write(entry: LogEntry): void {
    this.writeCompiled(entry);
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) this.writeCompiled(entry);
  }

  private writePretty(entry: LogEntry): void {
    const output = this.settings.format
      ? this.finalize(this.settings.format(entry))
      : this.renderDefault(entry);
    consoleWrite(entry.level, output, true);
  }

  /** Cased author text, memoized: authors repeat across entries. */
  private authorName(raw: string): string {
    if (this.authorTagCache?.raw === raw) return this.authorTagCache.tag;
    const tag = caseTag(raw, this.tagCase);
    this.authorTagCache = { raw, tag };
    return tag;
  }

  private renderDefault(entry: LogEntry): string {
    const levelColor = this.levelColors[entry.level];
    const tag = (value: string): string => applyColor(levelColor, `[${value}]`);
    let output = "";

    const time = entry.timestamp.slice(11, 19);
    const date = entry.timestamp.slice(5, 10);
    const year = entry.timestamp.slice(0, 4);

    if (this.settings.showTime) output += `${tag(time)} `;
    if (this.settings.showDate) output += `${tag(date)} `;
    if (this.settings.showYear) output += `${tag(year)} `;
    if (this.settings.showLevel) output += `${this.levelTags[entry.level]} `;
    if (this.settings.showAuthor) output += `${tag(this.authorName(entry.author))} `;

    // Keep the message and context readable; only the tags before it carry
    // the level color.
    const contextStr = formatContext(entry.context, this.settings.formatContext);
    output += `${entry.message}${contextStr}`;

    return this.finalize(output);
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
      ...entry.context,
    });
    consoleWrite(entry.level, output, false);
  }
}
