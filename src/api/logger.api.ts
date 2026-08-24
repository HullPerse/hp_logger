import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_AUTHOR } from "../config/logger.config";
import { runWithContext } from "../core/context.core";
import {
  addGlobalTransport,
  clearGlobalTransports,
  removeGlobalTransport,
  writeEntry,
} from "../core/pipeline.core";
import { formatDuration } from "../format/duration.format";
import { cachedTimestamp, formatTimestamp } from "../format/timestamp.format";
import { redact } from "../redact/index.redact";
import { attemptAsync } from "../lib/result.utils";
import { mergeSettings, resolveEnvLevel, resolveSettings } from "../lib/settings.utils";
import type {
  CreateLoggerOptions,
  LazyContext,
  LazyMessage,
  LogContext,
  LogEntry,
  LoggerStats,
  LogLevel,
  LoggerSettings,
  LoggerState,
  ResolvedSettings,
  TimestampFormat,
} from "../types/logger";
import type { Transport } from "../types/transport";
import type { WatchHandle, WatchHooks, WatchOptions } from "../types/watch";
import { startWatcher } from "../watch/index.watch";
import { buildTransports } from "../writer/factory.writer";

/** Numeric levels, inlined as constants in the hot path. */
const LEVEL_TRACE = LOG_LEVELS.trace;
const LEVEL_DEBUG = LOG_LEVELS.debug;
const LEVEL_INFO = LOG_LEVELS.info;
const LEVEL_SUCCESS = LOG_LEVELS.success;
const LEVEL_WARN = LOG_LEVELS.warn;
const LEVEL_ERROR = LOG_LEVELS.error;
const LEVEL_FATAL = LOG_LEVELS.fatal;
const EMPTY_STATS: LoggerStats = { dropped: 0, queued: 0, transportErrors: 0 };
const identity = (value: unknown): unknown => value;

const rateLimits = new Map<string, number>();
const onceKeys = new Set<string>();

export class Logger implements LoggerState {
  readonly author: string;
  context: LogContext;
  transport: Transport;
  // Assigned through applyHotSettings() in the constructor; TS cannot trace
  // the assignment through the helper, hence the definite-assignment marks.
  enabled!: boolean;
  levelThreshold!: number;
  redactKeys!: RegExp | null;
  redactDepth!: number;
  maxMessageLength!: number;
  formatTimestamp!: TimestampFormat;
  timestamp!: () => string;
  filters!: ((entry: LogEntry) => boolean)[];
  hasFilters!: boolean;
  hasStaticContext: boolean;
  needsRedaction!: boolean;
  redactValue!: (value: unknown) => unknown;
  private currentSettings: ResolvedSettings;
  private declarativeWatch: WatchHandle | null = null;
  private watchHandles: WatchHandle[] = [];

  constructor(
    author: string,
    currentSettings: ResolvedSettings,
    context: LogContext = {},
    declarativeWatch?: WatchOptions | false,
    transport?: Transport,
  ) {
    this.author = author;
    this.context = context;
    this.hasStaticContext = Object.keys(context).length > 0;
    this.currentSettings = currentSettings;
    this.applyHotSettings(currentSettings);
    this.transport = transport ?? buildTransports(currentSettings);
    if (declarativeWatch) this.rebindWatch(declarativeWatch);
  }

  /** Copy per-entry settings into direct fields so the write path reads primitives. */
  private applyHotSettings(settings: ResolvedSettings): void {
    this.enabled = settings.enabled;
    this.levelThreshold = LOG_LEVELS[settings.level];
    this.redactKeys = settings.redactKeys;
    this.redactDepth = settings.redactDepth;
    this.maxMessageLength = settings.maxMessageLength;
    this.formatTimestamp = settings.formatTimestamp;
    this.timestamp =
      settings.formatTimestamp === "iso" ? cachedTimestamp : () => formatTimestamp("local");
    this.filters = settings.filters;
    this.hasFilters = settings.filters.length > 0;
    this.needsRedaction = settings.redactKeys !== null;
    const { redactKeys } = settings;
    this.redactValue =
      redactKeys === null
        ? identity
        : (value) => redact(value, redactKeys, settings.redactDepth);
  }

  /** Override settings for this logger and all its descendants. */
  settings(changes: LoggerSettings): this {
    this.currentSettings = mergeSettings(this.currentSettings, changes);
    this.applyHotSettings(this.currentSettings);
    this.transport = buildTransports(this.currentSettings);
    if (changes.watch !== undefined) this.rebindWatch(changes.watch);
    return this;
  }

  /**
   * Poll a url or a custom probe and log availability edges. Transitions are
   * logged automatically (success/warn); single probes stay silent unless
   * options.logProbes is set. Watchers are stopped by close().
   */
  watch(options: WatchOptions, hooks: WatchHooks = {}): WatchHandle {
    const handle = startWatcher(
      (level, message, context) => {
        if (level === "success") this.success(message, context);
        else if (level === "warn") this.warn(message, context);
        else this.debug(message, context);
      },
      options,
      hooks,
    );
    this.watchHandles.push(handle);
    return handle;
  }

  /** Replace or clear the watcher declared through settings on this logger. */
  private rebindWatch(config: WatchOptions | false): void {
    if (this.declarativeWatch) {
      const index = this.watchHandles.indexOf(this.declarativeWatch);
      if (index !== -1) this.watchHandles.splice(index, 1);
      this.declarativeWatch.stop();
      this.declarativeWatch = null;
    }
    if (config && (config.url || config.probe)) {
      this.declarativeWatch = this.watch(config);
    }
  }

  /** Create a named child module with optional settings override. */
  module(name: string, settingsOverride?: LoggerSettings): Logger {
    const settings = settingsOverride
      ? mergeSettings(this.currentSettings, settingsOverride)
      : this.currentSettings;
    return new Logger(name, settings, { ...this.context });
  }

  /** Create a child logger with extra persistent context. */
  child(context: LogContext): Logger {
    return new Logger(this.author, this.currentSettings, {
      ...this.context,
      ...context,
    });
  }

  addContext(context: LogContext): this {
    this.context = { ...this.context, ...context };
    this.hasStaticContext = Object.keys(this.context).length > 0;
    return this;
  }

  /** Run a function with an async-local context merged into every entry. */
  withContext<T>(context: LogContext, fn: () => T): T {
    const scopedContext = this.hasStaticContext ? { ...this.context, ...context } : { ...context };
    return runWithContext(scopedContext, fn);
  }

  logEvent(level: LogLevel, eventName: string, context: LogContext = {}): void {
    this.write(level, eventName, { event: eventName, ...context });
  }

  // Level methods inline the numeric threshold check: a disabled level
  // returns before the write() call, the LOG_LEVELS lookup and any argument
  // work. `levelThreshold` is a number on the instance, updated by
  // settings(), so the comparison stays dynamic.

  trace(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_TRACE < this.levelThreshold) return;
    this.write("trace", message, context);
  }

  debug(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_DEBUG < this.levelThreshold) return;
    this.write("debug", message, context);
  }

  info(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_INFO < this.levelThreshold) return;
    this.write("info", message, context);
  }

  success(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_SUCCESS < this.levelThreshold) return;
    this.write("success", message, context);
  }

  warn(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_WARN < this.levelThreshold) return;
    this.write("warn", message, context);
  }

  error(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_ERROR < this.levelThreshold) return;
    this.write("error", message, context);
  }

  fatal(message: LazyMessage, context?: LazyContext): void {
    if (LEVEL_FATAL < this.levelThreshold) return;
    this.write("fatal", message, context);
  }

  /** Measure a function and log its duration. Returns the function result. */
  async time<T>(name: string, fn: () => Promise<T> | T, level: LogLevel = "success"): Promise<T> {
    const startedAt = performance.now();
    const outcome = await attemptAsync(() => fn());
    const durationMs = Math.round(performance.now() - startedAt);
    this.write(level, `${name} completed in ${formatDuration(durationMs)}`, {
      durationMs,
      operation: name,
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  /** Log once per key: subsequent calls with the same key are dropped. */
  once(key: string, message: LazyMessage, context?: LazyContext): void {
    if (onceKeys.has(key)) return;
    onceKeys.add(key);
    this.write("warn", message, context);
  }

  /** Log at most once per interval: extra calls within `ms` are dropped. */
  throttle(
    key: string,
    ms: number,
    message: LazyMessage,
    context?: LazyContext,
    level: LogLevel = "warn",
  ): void {
    const now = Date.now();
    const lastLogAt = rateLimits.get(key);
    if (lastLogAt !== undefined && now - lastLogAt < ms) return;
    rateLimits.set(key, now);
    this.write(level, message, context);
  }

  private write(level: LogLevel, message: LazyMessage, context?: LazyContext): void {
    writeEntry(this, level, message, context);
  }

  stats(): LoggerStats {
    return this.transport.stats?.() ?? EMPTY_STATS;
  }

  /** Register a transport for every logger in the process. */
  static addTransport(transport: Transport): void {
    addGlobalTransport(transport);
  }

  /** Remove a previously registered global transport. */
  static removeTransport(transport: Transport): void {
    removeGlobalTransport(transport);
  }

  static clearTransports(): void {
    clearGlobalTransports();
  }

  async close(): Promise<void> {
    for (const handle of this.watchHandles.splice(0)) handle.stop();
    this.declarativeWatch = null;
    await this.transport.close?.();
  }
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const settings = resolveSettings({
    ...options.settings,
    level: options.settings?.level ?? resolveEnvLevel(),
  });
  return new Logger(options.author ?? DEFAULT_AUTHOR, settings, {}, options.settings?.watch);
};

let globalErrorHandlersInstalled = false;

export const installErrorHandlers = (logger: Logger): void => {
  if (globalErrorHandlersInstalled) return;
  globalErrorHandlersInstalled = true;
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", { reason });
  });
  process.on("uncaughtException", (error) => {
    logger.error("uncaughtException", { error });
  });
  // Bun 1.4 emits memoryPressure when the OS runs low on memory.
  // Log it before the process gets killed, so the last lines show why.
  if (typeof process.versions.bun === "string") {
    process.on("memoryPressure" as never, (level: string) => {
      logger.warn("memoryPressure", { level });
    });
  }
};
