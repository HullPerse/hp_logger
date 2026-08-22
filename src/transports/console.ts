import type { sliceAnsi, wrapAnsi } from 'bun';

import type {
  ColorName,
  LogEntry,
  LogLevel,
  ResolvedSettings,
  Transport,
} from '../types';
import { applyColor, DEFAULT_LEVEL_COLORS } from '../colors.utils';
import { formatContext } from '../utils';

const LEVEL_NAMES: LogLevel[] = [
  'trace',
  'debug',
  'info',
  'success',
  'warn',
  'error',
  'fatal',
];

type LevelTagMap = Record<LogLevel, string>;
type LevelColorMap = Record<LogLevel, ColorName | false | undefined>;

export class ConsoleTransport implements Transport {
  private readonly levelColors: LevelColorMap;
  private readonly levelTags: LevelTagMap;
  private readonly settings: ResolvedSettings;

  constructor(settings: ResolvedSettings) {
    this.settings = settings;
    this.levelColors = Object.fromEntries(
      LEVEL_NAMES.map((level) => [level, this.colorFor(level)])
    ) as LevelColorMap;
    this.levelTags = Object.fromEntries(
      LEVEL_NAMES.map((level) => [
        level,
        applyColor(this.levelColors[level], `[${level.toUpperCase()}]`),
      ])
    ) as LevelTagMap;
  }

  write(entry: LogEntry): void {
    if (this.settings.mode === 'json') {
      ConsoleTransport.writeJson(entry);
    } else {
      this.writePretty(entry);
    }
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) this.write(entry);
  }

  private writePretty(entry: LogEntry): void {
    const output = this.settings.format
      ? this.finalize(this.settings.format(entry))
      : this.renderDefault(entry);

    if (entry.level === 'error' || entry.level === 'fatal') console.error(output);
    else if (entry.level === 'warn') console.warn(output);
    else if (entry.level === 'debug' || entry.level === 'trace') console.debug(output);
    else console.log(output);
  }

  private renderDefault(entry: LogEntry): string {
    const levelColor = this.levelColors[entry.level];
    const tag = (value: string): string => applyColor(levelColor, `[${value}]`);
    let output = '';

    const time = entry.timestamp.slice(11, 19);
    const date = entry.timestamp.slice(5, 10);
    const year = entry.timestamp.slice(0, 4);

    if (this.settings.showTime) output += `${tag(time)} `;
    if (this.settings.showDate) output += `${tag(date)} `;
    if (this.settings.showYear) output += `${tag(year)} `;
    if (this.settings.showLevel) output += `${this.levelTags[entry.level]} `;
    if (this.settings.showAuthor) output += `${tag(entry.author)} `;

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
        result = bunRuntime.sliceAnsi(result, 0, prettyTruncate, '…');
      }
      if (prettyWrap !== false) {
        result = bunRuntime.wrapAnsi(result, prettyWrap, { wordWrap: true });
      }
      return result;
    }

    let result = line;
    if (prettyTruncate !== false) {
      result = result.length > prettyTruncate
        ? `${result.slice(0, prettyTruncate - 1)}…`
        : result;
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

    if (entry.level === 'error' || entry.level === 'fatal') console.error(output);
    else if (entry.level === 'warn') console.warn(output);
    else console.log(output);
  }
}
