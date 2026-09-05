import { writeFile } from "node:fs/promises";
import { LruCache } from "../brain/lru.utils.js";
import { brainSnapshots, registerBrainCache } from "../brain/registry.utils.js";
import { RingBuffer } from "../brain/ring.utils.js";
import { LOG_LEVELS } from "../config/levels.config.js";
import { DEFAULT_AUTHOR, ONCE_THROTTLE_CACHE_CAP } from "../config/logger.config.js";
import { runWithContext } from "../core/context.core.js";
import { buildEntry, buildEntryFast } from "../core/entry.core.js";
import {
  addGlobalTransport,
  clearGlobalTransports,
  registerLeveledWrapper,
  removeGlobalTransport,
  takeLeveledWrapper,
  writeEntry,
} from "../core/pipeline.core.js";
import { renderTable } from "../format/table.format.js";
import { cachedTimestamp, formatTimestamp } from "../format/timestamp.format.js";
import { createSampler } from "../lib/sampling.utils.js";
import {
  createCounter as createCounterHelper,
  createGauge as createGaugeHelper,
  createHistogram as createHistogramHelper,
  ensureAutoCounter as ensureAutoCounterHelper,
  getMetricsText as getMetricsTextHelper,
  getOrCreateRegistry as getRegistryHelper,
  writeMetricsBox as writeMetricsBoxHelper,
} from "./metrics.api.js";
import { spanImpl, timeImpl, traceTreeImpl } from "./span.api.js";
import { taskImpl } from "./task.api.js";
import { rebindWatchImpl, watchImpl } from "./watch.api.js";
import {
  isTraversalBlocked,
  matchEnvModule,
  mergeSettings,
  resolveEnvLevel,
  resolveEnvModules,
  resolveSettings,
  warnOutsideCwd,
} from "../lib/settings.utils.js";
import type { Counter } from "../metrics/counter.metric.js";
import type { Gauge } from "../metrics/gauge.metric.js";
import type { Histogram } from "../metrics/histogram.metric.js";
import { OperationProfiler } from "../metrics/profiler.metric.js";
import type { Registry } from "../metrics/registry.metric.js";
import { compileRedactPaths, redactCompiled } from "../redact/index.redact.js";
import { buildResolverSet } from "../resolvers/index.resolver.js";
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
  ResolverSet,
  SpanHandle,
  TaskHandle,
  TaskOptions,
  TimeOptions,
  TimestampFormat,
} from "../types/logger.js";
import type { MetricOptions } from "../types/metrics.js";
import type { Transport } from "../types/transport.js";
import type { WatchHandle, WatchHooks, WatchOptions } from "../types/watch.js";
import { buildTransports } from "../writer/factory.writer.js";
import { LeveledTransport } from "../writer/leveled.writer.js";

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

/** Compile the per-entry redaction closure; identity when nothing needs masking. */
const compileRedactValue = (settings: ResolvedSettings): ((value: unknown) => unknown) => {
  const { redactKeys, redactCensor, redactPii } = settings;
  const compiledPaths = compileRedactPaths(settings.redactPaths);
  if (redactKeys === null && compiledPaths === null && redactPii === false) return identity;
  return (value) =>
    redactCompiled(
      value,
      redactKeys,
      settings.redactDepth,
      compiledPaths,
      redactCensor,
      redactPii,
    );
};

const rateLimits = new LruCache<string, number>(ONCE_THROTTLE_CACHE_CAP);
const onceKeys = new LruCache<string, true>(ONCE_THROTTLE_CACHE_CAP);

registerBrainCache("logger.once", () => onceKeys.stats());
registerBrainCache("logger.throttle", () => rateLimits.stats());

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
  sampler!: ((entry: LogEntry) => boolean) | undefined;
  serializers!: Record<string, (value: unknown) => unknown> | undefined;
  resolvers!: ResolverSet | undefined;
  mixin!: ((context: LogContext, level: LogLevel) => LogContext) | undefined;
  schemaVersion!: boolean | undefined;
  callSite!: boolean | undefined;
  baseFields: Record<string, unknown> | undefined;
  entryPlan!: (
    state: LoggerState,
    level: LogLevel,
    message: LazyMessage,
    context: LazyContext | undefined,
  ) => LogEntry | null;
  private currentSettings: ResolvedSettings;
  private readonly envModuleLevels: Map<string, LogLevel> | undefined;
  private blackboxRing: RingBuffer<LogEntry> | null = null;
  private declarativeWatch: WatchHandle | null = null;
  private metricsRegistryInstance: Registry | null = null;
  private autoCounter: Counter | null = null;
  private watchHandles: WatchHandle[] = [];
  private paused = false;
  private pauseBuffer: { level: LogLevel; message: LazyMessage; context: LazyContext | undefined }[] = [];
  private pauseDropped = 0;
  private static readonly PAUSE_CAP = 10_000;
  // Null when settings.profile is off (one null check on the measurement
  // path).
  private profiler: OperationProfiler | null = null;

  constructor(
    author: string,
    currentSettings: ResolvedSettings,
    context: LogContext = {},
    declarativeWatch?: WatchOptions | false,
    transport?: Transport,
    envModuleLevels?: Map<string, LogLevel>,
  ) {
    this.author = author;
    this.context = context;
    this.hasStaticContext = Object.keys(context).length > 0;
    this.currentSettings = currentSettings;
    this.envModuleLevels = envModuleLevels;
    this.applyHotSettings(currentSettings);
    this.transport = transport ?? buildTransports(currentSettings);
    if (declarativeWatch) this.rebindWatch(declarativeWatch);
    if (currentSettings.autoCounters) this.ensureAutoCounter();
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
    this.needsRedaction =
      settings.redactKeys !== null ||
      settings.redactPaths.length > 0 ||
      settings.redactPii !== false;
    this.serializers = settings.serializers;
    this.resolvers = settings.resolvers
      ? buildResolverSet(settings.resolvers) || undefined
      : undefined;
    this.mixin = settings.mixin;
    this.schemaVersion = settings.schemaVersion ? true : undefined;
    this.callSite = settings.callSite ? true : undefined;
    this.baseFields =
      settings.baseFields === false ? undefined : settings.baseFields;
    this.sampler = settings.sampling
      ? createSampler(settings.sampling.rate, settings.sampling.perTrace)
      : undefined;
    this.redactValue = compileRedactValue(settings);
    // Compiled entry plan: the specialized builder only when every optional
    // per-entry feature is off. Recomputed here, so settings() recompiles.
    this.entryPlan =
      this.needsRedaction ||
      this.serializers !== undefined ||
      this.mixin !== undefined ||
      this.hasFilters ||
      this.schemaVersion === true
        ? buildEntry
        : buildEntryFast;
    if (settings.blackbox) {
      this.blackboxRing ??= new RingBuffer(settings.blackbox.size);
    } else {
      this.blackboxRing = null;
    }
    if (settings.profile) {
      this.profiler ??= new OperationProfiler(
        this.metricsRegistry(),
        settings.profile.maxOperations,
      );
    } else {
      this.profiler = null;
    }
  }

  /** Flight-recorder ring read by the write pipeline; undefined when disabled. */
  get blackbox(): { push: (entry: LogEntry) => void } | undefined {
    return this.blackboxRing ?? undefined;
  }

  /** Override settings for this logger and all its descendants. */
  settings(changes: LoggerSettings): this {
    this.currentSettings = mergeSettings(this.currentSettings, changes);
    this.applyHotSettings(this.currentSettings);
    this.transport = buildTransports(this.currentSettings);
    if (changes.autoCounters) this.ensureAutoCounter();
    if (changes.watch !== undefined) this.rebindWatch(changes.watch);
    return this;
  }

  /** Lazy registry for logger metrics; created on first metric usage. */
  private metricsRegistry(): Registry {
    return getRegistryHelper(this);
  }

  private ensureAutoCounter(): void {
    ensureAutoCounterHelper(this);
  }

  /** Create a counter bound to this logger's registry. */
  counter(options: Omit<MetricOptions, "registers">): Counter {
    return createCounterHelper(this, options);
  }

  /** Create a gauge bound to this logger's registry. */
  gauge(options: Omit<MetricOptions, "registers">): Gauge {
    return createGaugeHelper(this, options);
  }

  /** Create a histogram bound to this logger's registry. */
  histogram(
    options: Omit<MetricOptions, "registers"> & { buckets?: readonly number[] },
  ): Histogram {
    return createHistogramHelper(this, options);
  }

  /** All logger metrics in Prometheus text format, ready for a /metrics endpoint. */
  metricsText(): string {
    return getMetricsTextHelper(this);
  }

  /**
   * Render every metric of this logger's registry as an ASCII-framed table
   * and write it at the given level. Pretty console shows the frame; JSON,
   * file and database transports receive the same plain-text table.
   */
  metricsBox(level: LogLevel = "info"): void {
    writeMetricsBoxHelper(this, level);
  }


  /**
   * Poll a url or a custom probe and log availability edges. Transitions are
   * logged automatically (success/warn); single probes stay silent unless
   * options.logProbes is set. Watchers are stopped by close().
   */
  watch(options: WatchOptions, hooks: WatchHooks = {}): WatchHandle {
    return watchImpl(this, options, hooks);
  }

  /** Replace or clear the watcher declared through settings on this logger. */
  private rebindWatch(config: WatchOptions | false): void {
    rebindWatchImpl(this, config);
  }


  /** Create a named child module with optional settings override. */
  module(name: string, settingsOverride?: LoggerSettings): Logger {
    const envLevel = matchEnvModule(this.envModuleLevels, name);
    const settings = settingsOverride
      ? mergeSettings(this.currentSettings, settingsOverride)
      : this.currentSettings;
    if (envLevel === undefined || envLevel === settings.level) {
      return new Logger(
        name,
        settings,
        { ...this.context },
        false,
        undefined,
        this.envModuleLevels,
      );
    }
    return new Logger(
      name,
      mergeSettings(settings, { level: envLevel }),
      { ...this.context },
      false,
      undefined,
      this.envModuleLevels,
    );
  }

  /** Create a child logger with extra persistent context. */
  child(context: LogContext): Logger {
    return new Logger(
      this.author,
      this.currentSettings,
      {
        ...this.context,
        ...context,
      },
      false,
      undefined,
      this.envModuleLevels,
    );
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

  // Single gate for the level methods: the numeric compare runs first, so a
  // disabled level returns before writeNormalized and any argument work.
  private writeGated(
    level: LogLevel,
    gate: number,
    first: LazyMessage | LogContext,
    second?: LazyContext | string,
  ): void {
    if (gate < this.levelThreshold) return;
    this.writeNormalized(level, first, second);
  }

  trace(message: LazyMessage, context?: LazyContext): void;
  trace(context: LogContext, message?: string): void;
  trace(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("trace", LEVEL_TRACE, first, second);
  }

  debug(message: LazyMessage, context?: LazyContext): void;
  debug(context: LogContext, message?: string): void;
  debug(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("debug", LEVEL_DEBUG, first, second);
  }

  info(message: LazyMessage, context?: LazyContext): void;
  info(context: LogContext, message?: string): void;
  info(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("info", LEVEL_INFO, first, second);
  }

  success(message: LazyMessage, context?: LazyContext): void;
  success(context: LogContext, message?: string): void;
  success(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("success", LEVEL_SUCCESS, first, second);
  }

  warn(message: LazyMessage, context?: LazyContext): void;
  warn(context: LogContext, message?: string): void;
  warn(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("warn", LEVEL_WARN, first, second);
  }

  error(message: LazyMessage, context?: LazyContext): void;
  error(context: LogContext, message?: string): void;
  error(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("error", LEVEL_ERROR, first, second);
  }

  fatal(message: LazyMessage, context?: LazyContext): void;
  fatal(context: LogContext, message?: string): void;
  fatal(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    this.writeGated("fatal", LEVEL_FATAL, first, second);
  }

  /**
   * Measure a function and log its duration. Returns the function result.
   * Pass `maxMs` to warn when the measurement exceeds the threshold.
   */
  time<T>(name: string, fn: () => Promise<T> | T, options: TimeOptions = {}): Promise<T> {
    return timeImpl(this, name, fn, options);
  }


  /**
   * Start a manual span. Call `end()` to log the measured duration, or pass a
   * callback to run inside the span's async-local context: all entries
   * inside the callback (including child spans) carry the span and trace ids.
   */
  span<T>(name: string, callback: (span: SpanHandle) => T | Promise<T>): Promise<T>;
  span<T>(
    name: string,
    options: TimeOptions,
    callback: (span: SpanHandle) => T | Promise<T>,
  ): Promise<T>;
  span(name: string, options?: TimeOptions): SpanHandle;
  span<T>(
    name: string,
    optionsOrCallback?: TimeOptions | ((span: SpanHandle) => T | Promise<T>),
    maybeCallback?: (span: SpanHandle) => T | Promise<T>,
  ): SpanHandle | Promise<T> {
    return (spanImpl as unknown as (a: unknown, b: string, c: unknown, d: unknown) => SpanHandle | Promise<T>)(this, name, optionsOrCallback, maybeCallback);
  }

  /** Render the span tree for a trace (default: most recent) as an ASCII tree. */
  traceTree(traceId?: string): void {
    traceTreeImpl(this, traceId);
  }


  /**
   * Track a pending task: a started entry, then a done/failed entry with the
   * duration. In the callback form, entries logged inside run under the
   * task's group (pretty output nests them) and carry the span and trace ids;
   * leaving the callback without done()/fail() finalizes the task, an error
   * marks it failed.
   */
  task<T>(name: string, callback: (task: TaskHandle) => T | Promise<T>): Promise<T>;
  task(name: string, options?: TaskOptions): TaskHandle;
  task<T>(
    name: string,
    optionsOrCallback?: TaskOptions | ((task: TaskHandle) => T | Promise<T>),
  ): TaskHandle | Promise<T> {
    return (taskImpl as unknown as (a: unknown, b: string, c: unknown) => TaskHandle | Promise<T>)(this, name, optionsOrCallback);
  }

  /** Render rows as a plain-text table and log it at the given level. */
  table(rows: readonly Record<string, unknown>[], level: LogLevel = "info"): void {
    this.write(level, renderTable(rows));
  }

  /** Log once per key: subsequent calls with the same key are dropped. */
  once(key: string, message: LazyMessage, context?: LazyContext): void {
    if (onceKeys.has(key)) return;
    onceKeys.set(key, true);
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

  /**
   * Route a normalized call into write() without allocating an argument
   * object: the two accepted signatures are resolved with locals only.
   */
  private writeNormalized(
    level: LogLevel,
    first: LazyMessage | LogContext,
    second?: LazyContext | string,
  ): void {
    if (typeof first === "string" || typeof first === "function") {
      this.write(level, first, second as LazyContext | undefined);
      return;
    }
    if (typeof second === "string") {
      this.write(level, second, first);
      return;
    }
    this.write(level, () => JSON.stringify(first), second as LazyContext | undefined);
  }

  /**
   * Buffer entries instead of dispatching to transports. Entries are held
   * in FIFO order and drained on resume(). Flush/close work even while
   * paused so the transport pipeline stays functional.
   */
  pause(): this {
    this.paused = true;
    return this;
  }

  /**
   * Drain buffered entries to transports in FIFO order, then resume
   * normal logging. Flush errors never propagate.
   */
  // eslint-disable-next-line require-await -- resume keeps the Promise<void> contract; the drain itself is synchronous.
  async resume(): Promise<void> {
    this.paused = false;
    const entries = this.pauseBuffer.splice(0);
    for (const { level, message, context } of entries) {
      writeEntry(this, level, message, context);
    }
  }
  private write(level: LogLevel, message: LazyMessage, context?: LazyContext): void {
    if (this.autoCounter !== null) {
      this.autoCounter.inc({ author: this.author, level });
    }
    let merged: LazyContext | undefined = context;
    if (this.groupStack.length > 0) {
      const groupPrefix = { group: this.groupStack.join(".") };
      merged =
        typeof context === "function"
          ? (): LogContext => ({ ...groupPrefix, ...context() })
          : { ...groupPrefix, ...context };
    }
    if (this.paused) {
      if (this.pauseBuffer.length >= Logger.PAUSE_CAP) {
        this.pauseDropped += 1;
        return;
      }
      this.pauseBuffer.push({ context: merged, level, message });
      return;
    }
    writeEntry(this, level, message, merged);
  }

  private groupStack: string[] = [];

  /** Open an indentation group for subsequent entries; nests like console.group. */
  group(name: string): void {
    this.groupStack.push(name);
  }

  /** Close the innermost open group created by group(). */
  groupEnd(): void {
    this.groupStack.pop();
  }

  /** Log an error when the condition is falsy; silent when it is truthy. */
  assert(condition: unknown, message?: string): void {
    if (condition) return;
    this.error(message === undefined ? "Assertion failed" : `Assertion failed: ${message}`);
  }

  stats(): LoggerStats {
    const base = this.transport.stats?.() ?? EMPTY_STATS;
    const own: Record<string, object> = {};
    if (this.blackboxRing !== null) own["blackboxRing"] = this.blackboxRing.stats();
    if (this.profiler !== null) own["profileCache"] = this.profiler.stats();
    if (this.pauseBuffer.length > 0 || this.pauseDropped > 0) {
      own["pause"] = { dropped: this.pauseDropped, queued: this.pauseBuffer.length };
    }
    const queued = base.queued + this.pauseBuffer.length;
    const dropped = base.dropped + this.pauseDropped;
    return { ...base, caches: { ...brainSnapshots(), ...own }, dropped, queued };
  }

  /**
   * Deliver buffered entries (batching queues, file buffers, database queue)
   * without closing. A flushed logger keeps logging; flush errors never
   * propagate to the caller.
   */
  async flush(): Promise<void> {
    try {
      await this.resolvers?.waitForIdle();
      await this.transport.flush?.();
    } catch {
      // A failing transport must not crash the flushing caller.
    }
  }

  /**
   * Write the black box ring to its JSONL file (or the given path) as a
   * snapshot - each dump replaces the file - and flush all transports.
   * Returns the path written, or null when the black box is disabled, empty
   * or has no path.
   */
  async dump(pathOverride?: string): Promise<string | null> {
    const target =
      pathOverride ?? (this.currentSettings.blackbox ? this.currentSettings.blackbox.path : undefined);
    const ring = this.blackboxRing;
    if (target === undefined || ring === null || ring.size === 0) return null;
    // Soft guard: block traversal, warn when outside cwd.
    if (isTraversalBlocked(target)) {
      console.warn(`hp_logger: dump path blocked: ${target} (traversal)`);
      return null;
    }
    warnOutsideCwd("dump", target);
    const lines = ring
      .toArray()
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await writeFile(target, `${lines}\n`, "utf-8");
    await this.transport.flush?.();
    return target;
  }

  /** Register a transport for every logger in the process. */
  static addTransport(transport: Transport, options?: { level?: LogLevel }): void {
    if (options?.level !== undefined) {
      const leveled = new LeveledTransport(transport, options.level);
      registerLeveledWrapper(transport, leveled);
      addGlobalTransport(leveled);
      return;
    }
    addGlobalTransport(transport);
  }

  /** Remove a previously registered global transport. */
  static removeTransport(transport: Transport): void {
    const leveled = takeLeveledWrapper(transport);
    if (leveled !== undefined) {
      removeGlobalTransport(leveled);
      return;
    }
    removeGlobalTransport(transport);
  }

  static clearTransports(): void {
    clearGlobalTransports();
  }

  /**
   * Force a rotation on every transport that supports it (size-based
   * file writers roll to the next numbered segment). Transports without
   * rotate() silently ignore the call.
   */
  async rotate(): Promise<void> {
    await this.transport.rotate?.();
  }

  async close(): Promise<void> {
    for (const handle of this.watchHandles.splice(0)) handle.stop();
    this.declarativeWatch = null;
    await this.resolvers?.waitForIdle();
    await this.transport.close?.();
  }
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const settings = resolveSettings({
    ...options.settings,
    level: options.settings?.level ?? resolveEnvLevel(),
  });
  return new Logger(
    options.author ?? DEFAULT_AUTHOR,
    settings,
    {},
    options.settings?.watch,
    undefined,
    resolveEnvModules(),
  );
};

let globalErrorHandlersInstalled = false;

export const installErrorHandlers = (logger: Logger): void => {
  if (globalErrorHandlersInstalled) return;
  globalErrorHandlersInstalled = true;
  // Post-mortem: black box dump first, then flush every transport, so
  // buffered entries reach disk before the process goes down. Failures here
  // must never mask the original crash, so everything is swallowed.
  const postMortem = async (): Promise<void> => {
    try {
      await logger.dump();
    } catch {
      // Dying processes do not report their own reporter's failures.
    }
    try {
      await logger.flush();
    } catch {
      // Same: flush errors stay silent on the crash path.
    }
  };
  const onCrash = (message: string, error: unknown): void => {
    logger.error(message, { error });
    // Fire-and-forget on purpose: the crash path must not await anything.
    postMortem();
  };
  process.on("unhandledRejection", (reason) => {
    onCrash("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    onCrash("uncaughtException", error);
  });
  // Bun 1.4 emits memoryPressure when the OS runs low on memory.
  // Log it before the process gets killed, so the last lines show why.
  if (typeof process.versions.bun === "string") {
    process.on("memoryPressure" as never, (level: string) => {
      logger.warn("memoryPressure", { level });
    });
  }
};
