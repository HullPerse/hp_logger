import type { DatabaseSettings, FileSettings, Transport } from "./transport";
import type { WatchOptions } from "./watch";

export type LogLevel = "trace" | "debug" | "info" | "success" | "warn" | "error" | "fatal";

export type LogContext = Record<string, unknown>;

export type ColorName =
  | "black"
  | "blue"
  | "cyan"
  | "gray"
  | "green"
  | "magenta"
  | "red"
  | "white"
  | "yellow";

export type LevelColors = Partial<Record<LogLevel, ColorName | false>>;

export type TimestampFormat = "iso" | "local";

export type ContextFormat = "json" | "kv";

export type TagCase = "upper" | "lower" | "none";

export interface BatchingSettings {
  batchSize?: number;
  /** Maximum number of pending entries. New entries are dropped when full. */
  maxQueueSize?: number;
  /** Flush interval in milliseconds. */
  flushInterval?: number;
}

export interface LoggerStats {
  /** Entries waiting for or currently being delivered by this logger. */
  queued: number;
  /** Entries rejected because the async queue was full or closed. */
  dropped: number;
  /** Failed transport batches or writes observed by this logger. */
  transportErrors: number;
}

export interface LoggerSettings {
  /** Async batching for the console/file transports. `false` disables. */
  batching?: BatchingSettings | false;
  /** Per-level colors in pretty mode. `false` disables all colors. */
  colors?: false | LevelColors;
  /** Persist entries to a database through an adapter. `false` disables. */
  database?: DatabaseSettings | false;
  /** Master switch: `false` skips every entry. */
  enabled?: boolean;
  /** Write entries to a file in addition to the console. */
  file?: FileSettings | false;
  /** Filter entries before they reach any transport. */
  filters?: ((entry: LogEntry) => boolean)[];
  /** Custom pretty renderer for console and file output. */
  format?: EntryFormatter;
  /** How context renders in pretty mode: `json` object or `kv` key="value" pairs. */
  formatContext?: ContextFormat;
  /** Timestamp format in pretty mode. */
  formatTimestamp?: TimestampFormat;
  /** Minimum level that gets logged. */
  level?: LogLevel;
  /** Truncate message and context to this many characters. */
  maxMessageLength?: number;
  /** `pretty` tagged console output, `json` single-line structured output. */
  mode?: "pretty" | "json";
  /** Wrap pretty lines to this many terminal columns (Bun only, ANSI-safe). `false` disables. */
  prettyWrap?: number | false;
  /** Truncate pretty lines to this many visible columns with `…` (Bun only, ANSI-safe). `false` disables. */
  prettyTruncate?: number | false;
  /** Maximum nesting depth for redacting context values. */
  redactDepth?: number;
  /** Keys that get redacted in messages and context. `null` disables redaction. */
  redactKeys?: RegExp | null;
  /** Show the author/module tag in pretty output. */
  showAuthor?: boolean;
  /** Case transform for author and level tags in pretty output. Defaults to 'upper'. */
  tagCase?: TagCase;
  /**
   * Endpoint or custom probe to poll for availability. Attached only to the
   * logger it is declared on: module() and child() do not inherit it.
   */
  watch?: WatchOptions | false;
  /** Show the level tag like [INFO] in pretty output, colored per level. */
  showLevel?: boolean;
  /** Show the time tag `[HH:mm:ss]` in pretty output. Defaults to true. */
  showTime?: boolean;
  /** Show the month/day tag `[MM-DD]` in pretty output. Defaults to false. */
  showDate?: boolean;
  /** Show the year tag `[YYYY]` in pretty output. Defaults to false. */
  showYear?: boolean;
}

/**
 * Message or metadata can be a lazy thunk: it is only evaluated when the
 * entry passes the level check. Returns nothing when disabled.
 */
export type LazyMessage = string | (() => string);
export type LazyContext = LogContext | (() => LogContext);

/**
 * Custom pretty renderer for console and file output. Receives the full
 * entry and returns the line to write. Overrides the default
 * `[time] [author] [LEVEL] message` rendering and its tag settings.
 */
export type EntryFormatter = (entry: LogEntry) => string;

export interface ResolvedSettings {
  batching: BatchingSettings | false;
  colors: false | LevelColors;
  database: DatabaseSettings | false;
  enabled: boolean;
  file: FileSettings | false;
  filters: ((entry: LogEntry) => boolean)[];
  format: EntryFormatter | undefined;
  formatContext: ContextFormat;
  formatTimestamp: TimestampFormat;
  level: LogLevel;
  maxMessageLength: number;
  mode: "pretty" | "json";
  prettyTruncate: number | false;
  prettyWrap: number | false;
  redactDepth: number;
  redactKeys: RegExp | null;
  showAuthor: boolean;
  showLevel: boolean;
  showTime: boolean;
  showDate: boolean;
  showYear: boolean;
  tagCase: TagCase;
}

export interface LogEntry {
  author: string;
  context: LogContext;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface CreateLoggerOptions {
  /** Global settings applied to every module. */
  settings?: LoggerSettings;
  /** Optional root author for direct logging without modules. */
  author?: string;
}

/** The minimal shape of a logger that the core write pipeline reads. */
export interface LoggerState {
  author: string;
  context: LogContext;
  enabled: boolean;
  filters: ((entry: LogEntry) => boolean)[];
  formatTimestamp: TimestampFormat;
  hasFilters: boolean;
  hasStaticContext: boolean;
  levelThreshold: number;
  maxMessageLength: number;
  needsRedaction: boolean;
  redactDepth: number;
  redactValue: (value: unknown) => unknown;
  redactKeys: RegExp | null;
  timestamp: () => string;
  transport: Transport;
}
