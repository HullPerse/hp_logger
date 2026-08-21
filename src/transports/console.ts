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
    const parts: string[] = [];

    if (this.settings.showTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }

    if (this.settings.showLevel) {
      const color = this.colorFor(entry.level);
      parts.push(applyColor(color, `[${entry.level.toUpperCase()}]`));
    }

    if (this.settings.showAuthor) {
      const color = this.colorFor(entry.level);
      parts.push(applyColor(color, `[${entry.author}]`));
    }

    const messageColor =
      this.settings.colors === false ? undefined : this.colorFor(entry.level);
    const contextStr = formatContext(entry.context, this.settings.formatContext);
    parts.push(applyColor(messageColor, `${entry.message}${contextStr}`));

    const output = parts.join(' ');

    if (entry.level === 'error') console.error(output);
    else if (entry.level === 'warn') console.warn(output);
    else if (entry.level === 'debug') console.debug(output);
    else console.log(output);
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

    if (entry.level === 'error') console.error(output);
    else if (entry.level === 'warn') console.warn(output);
    else console.log(output);
  }
}
