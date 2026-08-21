export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  error: 4,
  info: 1,
  success: 2,
  warn: 3,
} as const;

export type LogContext = Record<string, unknown>;

export type ColorName =
  | 'black'
  | 'blue'
  | 'cyan'
  | 'gray'
  | 'green'
  | 'magenta'
  | 'red'
  | 'white'
  | 'yellow';

export type LevelColors = Partial<Record<LogLevel, ColorName | false>>;

export type TimestampFormat = 'iso' | 'local';

export interface AsyncSettings {
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface FileSettings {
  /** Directory for log files. Required when enabled. */
  path?: string;
  /** Rotate files by day into `path/{yyyy-mm-dd}/log_NNN.log`. */
  rotation?: 'daily' | 'none';
  enabled: boolean;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  maxFilesPerDay?: number;
}

export interface LoggerSettings {
  /** Async batching for the console/file transports. `false` disables. */
  async?: AsyncSettings | false;
  /** Per-level colors in pretty mode. `false` disables all colors. */
  colors?: false | LevelColors;
  /** Filter entries before they reach any transport. */
  filters?: ((entry: LogEntry) => boolean)[];
  /** Write entries to a file in addition to the console. */
  file?: FileSettings | false;
  /** Timestamp format in pretty mode. */
  formatTimestamp?: TimestampFormat;
  /** Minimum level that gets logged. */
  level?: LogLevel;
  /** Truncate message and context to this many characters. */
  maxMessageLength?: number;
  /** `pretty` colored console output, `json` single-line structured output. */
  mode?: 'pretty' | 'json';
  /** Keys that get redacted in messages and context. */
  redactKeys?: RegExp;
  /** Show the author/module tag in pretty output. */
  showAuthor?: boolean;
  /** Show the timestamp in pretty output. */
  showTimestamp?: boolean;
}

export interface ResolvedSettings {
  async: AsyncSettings | false;
  colors: false | LevelColors;
  file: FileSettings | false;
  filters: ((entry: LogEntry) => boolean)[];
  formatTimestamp: TimestampFormat;
  level: LogLevel;
  maxMessageLength: number;
  mode: 'pretty' | 'json';
  redactKeys: RegExp;
  showAuthor: boolean;
  showTimestamp: boolean;
}

export interface LogEntry {
  author: string;
  context: LogContext;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface Transport {
  close?: () => void | Promise<void>;
  write: (entry: LogEntry) => void | Promise<void>;
}

export interface LoggerConfig {
  settings: ResolvedSettings;
  author: string;
  context?: LogContext;
}

export const DEFAULT_REDACT_KEYS =
  /(?<secret>password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;

export const resolveSettings = (
  settings: LoggerSettings = {}
): ResolvedSettings => ({
  async: settings.async ?? false,
  colors: settings.colors ?? {},
  file: settings.file ?? false,
  filters: settings.filters ?? [],
  formatTimestamp: settings.formatTimestamp ?? 'iso',
  level: settings.level ?? 'info',
  maxMessageLength: settings.maxMessageLength ?? 2000,
  mode: settings.mode ?? 'pretty',
  redactKeys: settings.redactKeys ?? DEFAULT_REDACT_KEYS,
  showAuthor: settings.showAuthor ?? true,
  showTimestamp: settings.showTimestamp ?? true,
});

export const mergeSettings = (
  base: ResolvedSettings,
  patch: LoggerSettings
): ResolvedSettings => resolveSettings({
  async: patch.async ?? base.async,
  colors: patch.colors ?? base.colors,
  file: patch.file ?? base.file,
  filters: patch.filters ?? base.filters,
  formatTimestamp: patch.formatTimestamp ?? base.formatTimestamp,
  level: patch.level ?? base.level,
  maxMessageLength: patch.maxMessageLength ?? base.maxMessageLength,
  mode: patch.mode ?? base.mode,
  redactKeys: patch.redactKeys ?? base.redactKeys,
  showAuthor: patch.showAuthor ?? base.showAuthor,
  showTimestamp: patch.showTimestamp ?? base.showTimestamp,
});
