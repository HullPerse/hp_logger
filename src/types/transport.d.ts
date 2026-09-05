import type {
  ContextFormat,
  EntryFormatter,
  FormatSettings,
  LogEntry,
  LogLevel,
  TagCase,
} from "./logger.js";

export interface DatabaseAdapter {
  close?: () => void | Promise<void>;
  /** Persist a batch of entries. Called by DatabaseTransport on flush. */
  write: (entries: LogEntry[]) => void | Promise<void>;
}

/** Retry policy for failed adapter writes (`database.retry`). */
export interface RetrySettings {
  /**
   * Maximum write attempts per batch (the first try included) before the
   * batch is dropped and counted in `stats().dropped`. Defaults to 5.
   */
  attempts?: number;
  /** Delay growth between retries. Defaults to `exponential`. */
  backoff?: "exponential" | "linear" | "fixed";
  /** First wait in milliseconds and the base for growth. Defaults to 1000. */
  baseMs?: number;
  /** Upper bound of a single wait in milliseconds. Defaults to 30000. */
  maxMs?: number;
  /** Random share (0-1) of a wait added and subtracted to avoid herds. Defaults to 0. */
  jitter?: number;
}

/** Reconnect policy for a self-healing database transport (`database.reconnect`). */
export interface ReconnectSettings {
  /** Pause between adapter restarts in milliseconds. Defaults to 5000. */
  cooldownMs?: number;
  /**
   * Adapter restart tries per outage before the buffered backlog is dropped
   * and the transport gives up until the next failure. Defaults to 3.
   */
  maxAttempts?: number;
}

export interface DatabaseSettings {
  /** Adapter that persists entries (e.g. createSqliteAdapter). Required when enabled. */
  adapter?: DatabaseAdapter;
  /**
   * Factory for self-healing: after the retry cap is exhausted the transport
   * closes the dead adapter, waits `reconnect.cooldownMs` and rebuilds one
   * through this factory, draining the buffered backlog on success.
   */
  createAdapter?: () => DatabaseAdapter | Promise<DatabaseAdapter>;
  enabled: boolean;
  /** Flush interval in milliseconds. */
  flushInterval?: number;
  /** Minimum level that gets persisted. Defaults to the logger level. */
  level?: LogLevel;
  maxBufferSize?: number;
  /**
   * Backoff schedule for failed writes: the batch stays at the head of the
   * queue and is retried after an increasing delay instead of on the next
   * trigger. Without it, retries stay immediate (previous behavior).
   * Ignored during close(), which never waits.
   */
  retry?: RetrySettings | false;
  /** Adapter restart policy; requires `createAdapter` to have any effect. */
  reconnect?: ReconnectSettings | false;
}

export interface FileSettings {
  /** Directory for log files. Required when enabled. */
  path?: string;
  /** Entry format: `json` one line per entry, `pretty` readable text without colors. */
  mode?: "json" | "pretty";
  /** Rotate by day into `path/{yyyy-mm-dd}/log_NNN.log` or by size into `app.N.log` segments. */
  rotation?: "daily" | "size" | "none";
  enabled: boolean;
  /** Flush interval in milliseconds. */
  flushInterval?: number;
  maxBufferSize?: number;
  maxFilesPerDay?: number;
  /**
   * Write each level to its own file: `app.log` becomes `app.error.log`,
   * `app.warn.log` and so on. Daily rotation names them `{level}_NNN.log`.
   * Default false - all levels share one file.
   */
  splitByLevel?: boolean;
  /** Size rotation: rotate when the active file reaches this many bytes. Defaults to 10485760. */
  maxBytes?: number;
  /** Size rotation: number of rotated segments to keep. Defaults to 5. */
  maxFiles?: number;
  /** Size rotation: gzip rotated segments. Defaults to false. */
  gzip?: boolean;
  /**
   * Run fsync on the file descriptor when close() drains the transport, so
   * buffered entries survive a hard power loss. Adds shutdown latency.
   * Defaults to false.
   */
  fsync?: boolean;
}

/** Options shared by FileTransport and DateBasedFileTransport. */
export type FileTransportOptions = Omit<FileSettings, "enabled"> & {
  contextFormat?: ContextFormat;
  /** Daily-rotation file name prefix: `{prefix}_NNN.log`. Defaults to "log". */
  namePrefix?: string;
  /** Custom pretty renderer for file output. */
  format?: EntryFormatter | FormatSettings;
  /** Strip control characters from message and context. */
  stripControl?: boolean;
  /** Case transform for author and level tags in pretty file output. */
  tagCase?: TagCase;
};

export interface Transport {
  close?: () => void | Promise<void>;
  write: (entry: LogEntry) => void | Promise<void>;
  /** Batch write, used by AsyncTransport to avoid per-entry promises. */
  writeBatch?: (entries: LogEntry[]) => void | Promise<void>;
  /**
   * Deliver buffered entries without closing; a flushed transport stays
   * usable. Used by Logger.flush() and crash handlers.
   */
  flush?: () => void | Promise<void>;
  /**
   * Force a rotation now (size-based writers roll to the next numbered
   * segment). Optional; transports without rotation ignore it through
   * Logger.rotate().
   */
  rotate?: () => void | Promise<void>;
  /** Optional delivery counters exposed through Logger.stats(). */
  stats?: () => TransportStats;
}

export interface TransportStats {
  queued: number;
  dropped: number;
  transportErrors: number;
}

/** One buffered entry in the async transport queue. */
export interface QueuedEntry {
  entry: LogEntry;
  resolve: () => void;
}

export interface SqliteAdapterOptions {
  /** Table name for log entries. Defaults to `logs`. */
  table?: string;
  /**
   * Add and require a `version` INTEGER column holding the current log
   * schema version. Tables created without the column fail validation with
   * a migration hint. Defaults to false.
   */
  schemaVersion?: boolean;
}

/** Row shape persisted by the sqlite adapter. */
export interface LogRow {
  author: string;
  context: string;
  level: string;
  message: string;
  timestamp: string;
}
