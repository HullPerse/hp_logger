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
  /** Levels that flush the pending batch immediately, bypassing batchSize. */
  flushOn?: LogLevel[];
}

/** Options for adaptive throttling during error storms (`logger.adaptive`). */
export interface AdaptiveSettings {
  /** Sliding window in milliseconds for counting errors. Defaults to 10000. */
  windowMs?: number;
  /** Errors (error+fatal) per window that trigger throttling. Defaults to 20. */
  errorRate?: number;
  /** Fraction of debug/info/trace entries kept while throttled. Defaults to 0.1. */
  sample?: number;
  /** Quiet period after the rate drops before logging resumes fully. Defaults to 30000. */
  cooldownMs?: number;
}

export interface LoggerStats {
  /** Entries waiting for or currently being delivered by this logger. */
  queued: number;
  /** Entries rejected because the async queue was full or closed. */
  dropped: number;
  /** Failed transport batches or writes observed by this logger. */
  transportErrors: number;
}

/** Options for collapsing repeated identical entries (`logger.repeat`). */
export interface RepeatSettings {
  /** Group window in milliseconds. Defaults to 1000. */
  windowMs?: number;
  /** Maximum tracked groups; the oldest is flushed when exceeded. Defaults to 1000. */
  maxKeys?: number;
}

/** Options for logger.time() and logger.span(). */
export interface TimeOptions {
  /** Entry level for the finished measurement. Defaults to `success`. */
  level?: LogLevel;
  /** When the measurement exceeds this many ms, the entry is logged as warn with slow: true. */
  maxMs?: number;
  /**
   * Continue a trace that started in another service: pass the ids parsed
   * from a W3C `traceparent` header (`parseTraceparent`).
   */
  traceId?: string;
  parentSpanId?: string;
}

/** Handle returned by logger.span(). */
export interface SpanHandle {
  /** Unique id of this span within its trace. */
  spanId: string;
  /** Trace id shared by the root span and all its descendants. */
  traceId: string;
  /** Span id of the enclosing span, or undefined for a root span. */
  parentId: string | undefined;
  /** Whether `end()` was already called. Prevents double-logging in callback form. */
  ended: boolean;
  /** Write the finished measurement. Optional level overrides the span options. */
  end: (level?: LogLevel) => void;
}

/** A completed span recorded for tree rendering. */
export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentId: string | undefined;
  name: string;
  level: LogLevel;
  message: string;
  durationMs: number;
  timestamp: string;
}

/** Settings for `logger.task()`. */
export interface TaskSettings {
  /** Level of the started and progress entries. Defaults to "debug". */
  level?: LogLevel;
  /** Log a debug entry on every `update()` call. Defaults to false. */
  progress?: boolean;
}

/** Black box flight recorder: a ring of recent entries dumped on crash or demand. */
export interface BlackboxSettings {
  /** Ring capacity in entries. Defaults to 1000. */
  size?: number;
  /**
   * JSONL file written as a snapshot by `logger.dump()` and by crash handlers
   * installed via `installErrorHandlers` (each dump replaces the file).
   * Without a path, dump() only flushes transports and writes no file.
   */
  path?: string;
}

/** Which pretty-console blocks get an ASCII frame via `settings.box`. */
export interface BoxSettings {
  /** Frame error cause-chain blocks (context.error / context.reason). */
  error?: boolean;
  /** Frame the message and context of every fatal entry. */
  fatal?: boolean;
  /** Frame adaptive storm start/end notices (author "adaptive"). */
  storm?: boolean;
}

/** Profiler aggregation options for measured durations. */
export interface ProfileSettings {
  /**
   * Maximum distinct operation names tracked before new ones collapse into
   * the `_other` label. Defaults to 64.
   */
  maxOperations?: number;
}

/** Options for a single `logger.task()` call. */
export interface TaskOptions {
  /** Overrides settings.task.level for every entry of this task. */
  level?: LogLevel;
}

/** Handle returned by logger.task(). */
export interface TaskHandle {
  /** Whether done() or fail() already ran. Prevents double-logging. */
  ended: boolean;
  /** Mark the task done: logs a success entry with the duration. */
  done: (detail?: string) => void;
  /**
   * Mark the task failed: logs an error entry with the duration and,
   * when an Error is passed, its serialized cause chain.
   */
  fail: (detail?: string | Error) => void;
  /** Log a progress entry. No-op unless settings.task.progress is enabled. */
  update: (text: string, context?: LogContext) => void;
}

/** A node in the rendered span tree. */
export interface SpanNode {
  record: SpanRecord;
  children: SpanNode[];
}

export interface LoggerSettings {
  /**
   * During error storms, throttle verbose levels (sample debug/info/trace)
   * and group repeated errors into one summary per cycle. `false` disables.
   */
  adaptive?: AdaptiveSettings | false;
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
  format?: EntryFormatter | FormatSettings;
  /** How context renders in pretty mode: `json` object or `kv` key="value" pairs. */
  formatContext?: ContextFormat;
  /** Collapse repeated identical entries into `message ×N` summaries. `false` disables. */
  repeat?: RepeatSettings | false;
  /** Count every entry in a `hp_logger_entries_total` counter with level and author labels. Defaults to false. */
  autoCounters?: boolean;
  /** Timestamp format in pretty mode. */
  formatTimestamp?: TimestampFormat;
  /** Minimum level that gets logged. */
  level?: LogLevel;
  /** Truncate message and context to this many characters. */
  maxMessageLength?: number;
  /**
   * Enrichment hook merged under every entry's context before serializers
   * and redaction: request ids, tenant ids, feature flags. Receives the
   * merged context and the entry level; returns the fields to add (an empty
   * object adds nothing). Explicit call-site data wins over mixin fields;
   * a throwing mixin contributes nothing. Mixin output is treated as
   * untrusted input and passes through redaction like any other context.
   */
  mixin?: (context: LogContext, level: LogLevel) => LogContext;
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
  /**
   * Dot paths that get redacted in context, e.g. `user.password` or
   * `secrets.*` (everything under the prefix). Works even when
   * `redactKeys` is null. Arrays are summarized and not path-addressable.
   */
  redactPaths?: string[];
  /**
   * Per-key context transformers (pino-style serializers), applied before
   * redaction: `serializers: { user: (u) => ({ id: u.id }) }`. A throwing
   * serializer masks the key with `[SERIALIZER ERROR]`.
   */
  serializers?: Record<string, (value: unknown) => unknown>;
  /**
   * Stamp every entry with `v: 1` (the current log schema version) so JSONL
   * lines, black box dumps and database rows survive future format changes.
   * Defaults to false - no field is added.
   */
  schemaVersion?: boolean;
  /**
   * Trace-coherent sampling: `rate` 0..1. Entries sharing a traceId are
   * kept or dropped as a whole trace; entries without a traceId are sampled
   * individually. error and fatal entries always pass.
   */
  sampling?: { perTrace?: boolean; rate: number } | false;
  /** Show the author/module tag in pretty output. */
  showAuthor?: boolean;
  /** Case transform for author and level tags in pretty output. Defaults to 'upper'. */
  tagCase?: TagCase;
  /** Colorize JSON context in pretty console output. Defaults to false. */
  colorizeContext?: boolean;
  /** Strip control and terminal escape characters from message/context in pretty output. Defaults to false. */
  stripControl?: boolean;
  /** Show a level emoji tag like [⚠️] in pretty console output. Defaults to false. */
  emoji?: boolean;
  /** Show the elapsed-since-logger-start tag like [+1.2s] in pretty console output. Defaults to false. */
  showElapsed?: boolean;
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
  /** Pending-task entries via `logger.task()`. */
  task?: TaskSettings;
  /** Flight recorder ring dumped on crash or via `logger.dump()`. `false` disables. */
  blackbox?: BlackboxSettings | false;
  /**
   * ASCII box frames around dense pretty-console blocks (error cause chains,
   * fatal snapshots, adaptive storm notices). Off by default; each element
   * is opt-in. Applies to the default pretty renderer only - JSON, file and
   * template output are untouched.
   */
  box?: BoxSettings | false;
  /**
   * Aggregate every measured duration (`time()`, `span()`, `task()`) into a
   * per-operation histogram `hp_logger_operation_ms{operation}` shown by
   * `logger.metricsBox()` and `metricsText()`. Distinct operation names are
   * capped; overflow lands under `_other`. `false` disables.
   */
  profile?: boolean | ProfileSettings;
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

/** Template-based alternative to an `EntryFormatter` function. */
export interface FormatSettings {
  /**
   * Line template with `{token}` placeholders, e.g.
   * `"[{timestamp.time}] [{level.tag}] {author}: {message}"`. Any context
   * key works as a token; `{token:red}` forces a color, `{:green}text{:/}`
   * colors literal spans, `\{` escapes a brace. Unknown dotted tokens are
   * kept literally and warned about once; colors render in console only.
   */
  template: string;
}

export interface ResolvedSettings {
  adaptive: AdaptiveSettings | false;
  batching: BatchingSettings | false;
  colorizeContext: boolean;
  colors: false | LevelColors;
  stripControl: boolean;
  database: DatabaseSettings | false;
  emoji: boolean;
  enabled: boolean;
  file: FileSettings | false;
  filters: ((entry: LogEntry) => boolean)[];
  format: EntryFormatter | FormatSettings | undefined;
  formatContext: ContextFormat;
  formatTimestamp: TimestampFormat;
  level: LogLevel;
  maxMessageLength: number;
  mixin: ((context: LogContext, level: LogLevel) => LogContext) | undefined;
  mode: "pretty" | "json";
  prettyTruncate: number | false;
  prettyWrap: number | false;
  redactDepth: number;
  redactKeys: RegExp | null;
  redactPaths: string[];
  schemaVersion: boolean;
  serializers: Record<string, (value: unknown) => unknown> | undefined;
  sampling: { perTrace: boolean; rate: number } | false;
  repeat: RepeatSettings | false;
  autoCounters: boolean;
  showAuthor: boolean;
  showElapsed: boolean;
  showLevel: boolean;
  showTime: boolean;
  showDate: boolean;
  showYear: boolean;
  tagCase: TagCase;
  task: { level: LogLevel; progress: boolean };
  blackbox: { path: string | undefined; size: number } | false;
  box: { error: boolean; fatal: boolean; storm: boolean } | false;
  profile: { maxOperations: number } | false;
}

export interface LogEntry {
  author: string;
  context: LogContext;
  level: LogLevel;
  message: string;
  /**
   * Schema version stamped on every entry when `settings.schemaVersion` is
   * enabled, so stored JSONL lines can be detected and migrated later.
   */
  v?: number;
  /**
   * Active span names, root to leaf, for entries written inside a span or
   * task callback. Logger-generated metadata outside the redacted context.
   */
  spanPath?: readonly string[];
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
  /** Flight-recorder ring; entries are pushed post-filter, post-redaction. */
  readonly blackbox?: { push: (entry: LogEntry) => void } | undefined;
  /** Per-key context transformers, applied before redaction. */
  readonly serializers?: Record<string, (value: unknown) => unknown> | undefined;
  /** Enrichment hook merged under every entry context; undefined disables it. */
  readonly mixin?: ((context: LogContext, level: LogLevel) => LogContext) | undefined;
  /** Stamp entries with the schema version field; undefined or false disables. */
  readonly schemaVersion?: boolean | undefined;
  /** Sampling decision for a built entry; undefined disables sampling. */
  readonly sampler?: ((entry: LogEntry) => boolean) | undefined;
}
