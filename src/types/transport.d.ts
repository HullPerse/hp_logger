import type { ContextFormat, LogEntry, LogLevel } from "./logger";

export interface DatabaseAdapter {
  close?: () => void | Promise<void>;
  /** Persist a batch of entries. Called by DatabaseTransport on flush. */
  write: (entries: LogEntry[]) => void | Promise<void>;
}

export interface DatabaseSettings {
  /** Adapter that persists entries (e.g. createSqliteAdapter). Required when enabled. */
  adapter?: DatabaseAdapter;
  enabled: boolean;
  /** Flush interval in milliseconds. */
  flushInterval?: number;
  /** Minimum level that gets persisted. Defaults to the logger level. */
  level?: LogLevel;
  maxBufferSize?: number;
}

export interface FileSettings {
  /** Directory for log files. Required when enabled. */
  path?: string;
  /** Entry format: `json` one line per entry, `pretty` readable text without colors. */
  mode?: "json" | "pretty";
  /** Rotate files by day into `path/{yyyy-mm-dd}/log_NNN.log`. */
  rotation?: "daily" | "none";
  enabled: boolean;
  /** Flush interval in milliseconds. */
  flushInterval?: number;
  maxBufferSize?: number;
  maxFilesPerDay?: number;
}

/** Options shared by FileTransport and DateBasedFileTransport. */
export type FileTransportOptions = Omit<FileSettings, "enabled"> & {
  contextFormat?: ContextFormat;
};

export interface Transport {
  close?: () => void | Promise<void>;
  write: (entry: LogEntry) => void | Promise<void>;
  /** Batch write, used by AsyncTransport to avoid per-entry promises. */
  writeBatch?: (entries: LogEntry[]) => void | Promise<void>;
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
}

/** Row shape persisted by the sqlite adapter. */
export interface LogRow {
  author: string;
  context: string;
  level: string;
  message: string;
  timestamp: string;
}
