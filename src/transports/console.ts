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

export class ConsoleTransport implements Transport {
  private readonly settings: ResolvedSettings;

  constructor(settings: ResolvedSettings) {
    this.settings = settings;
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
    const parts: string[] = [];
    const levelColor = this.colorFor(entry.level);

    if (this.settings.showTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }

    if (this.settings.showLevel) {
      parts.push(applyColor(levelColor, `[${entry.level.toUpperCase()}]`));
    }

    if (this.settings.showAuthor) {
      parts.push(applyColor(levelColor, `[${entry.author}]`));
    }

    const messageColor =
      this.settings.colors === false ? undefined : levelColor;
    const contextStr = formatContext(entry.context, this.settings.formatContext);
    parts.push(applyColor(messageColor, `${entry.message}${contextStr}`));

    return this.finalize(parts.join(' '));
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
