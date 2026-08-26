import { writeFile } from "node:fs/promises";

import { LruCache } from "../brain/lru.utils";
import { brainSnapshots, registerBrainCache } from "../brain/registry.utils";
import { RingBuffer } from "../brain/ring.utils";
import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_AUTHOR, ONCE_THROTTLE_CACHE_CAP } from "../config/logger.config";
import { getAsyncContext, runWithContext, runWithSpanPath } from "../core/context.core";
import { buildEntry, buildEntryFast } from "../core/entry.core";
import {
  addGlobalTransport,
  clearGlobalTransports,
  registerLeveledWrapper,
  removeGlobalTransport,
  takeLeveledWrapper,
  writeEntry,
} from "../core/pipeline.core";
import { getSpanRegistry, inheritSpanContext } from "../core/span.core";
import { drawBox } from "../format/box.format";
import { formatDuration } from "../format/duration.format";
import { renderMetricsTable } from "../format/metrics.format";
import { renderSpanTree } from "../format/span.format";
import { renderTable } from "../format/table.format";
import { cachedTimestamp, formatTimestamp } from "../format/timestamp.format";
import { attemptAsync } from "../lib/result.utils";
import { createSampler } from "../lib/sampling.utils";
import {
  matchEnvModule,
  mergeSettings,
  resolveEnvLevel,
  resolveEnvModules,
  resolveSettings,
} from "../lib/settings.utils";
import { Counter } from "../metrics/counter.metric";
import { Gauge } from "../metrics/gauge.metric";
import { Histogram } from "../metrics/histogram.metric";
import { OperationProfiler } from "../metrics/profiler.metric";
import { Registry } from "../metrics/registry.metric";
import { compileRedactPaths, redactCompiled } from "../redact/index.redact";
import { buildResolverSet } from "../resolvers/index.resolver";
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
} from "../types/logger";
import type { MetricOptions } from "../types/metrics";
import type { Transport } from "../types/transport";
import type { WatchHandle, WatchHooks, WatchOptions } from "../types/watch";
import { startWatcher } from "../watch/index.watch";
import { buildTransports } from "../writer/factory.writer";
import { LeveledTransport } from "../writer/leveled.writer";

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
  // Profiler state: one registered histogram plus its bounded label cache.
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
    this.needsRedaction = settings.redactKeys !== null || settings.redactPaths.length > 0;
    this.serializers = settings.serializers;
    this.resolvers = settings.resolvers
      ? buildResolverSet(settings.resolvers) || undefined
      : undefined;
    this.mixin = settings.mixin;
    this.schemaVersion = settings.schemaVersion ? true : undefined;
    this.callSite = settings.callSite ? true : undefined;
    this.sampler = settings.sampling
      ? createSampler(settings.sampling.rate, settings.sampling.perTrace)
      : undefined;
    const { redactKeys } = settings;
    const compiledPaths = compileRedactPaths(settings.redactPaths);
    this.redactValue =
      redactKeys === null && compiledPaths === null
        ? identity
        : (value) => redactCompiled(value, redactKeys, settings.redactDepth, compiledPaths);
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
    if (this.metricsRegistryInstance === null) {
      this.metricsRegistryInstance = new Registry();
    }
    return this.metricsRegistryInstance;
  }

  private ensureAutoCounter(): void {
    if (this.autoCounter !== null) return;
    this.autoCounter = new Counter({
      help: "Log entries written by this logger",
      labelNames: ["author", "level"],
      name: "hp_logger_entries_total",
      registers: [this.metricsRegistry()],
    });
  }

  /** Create a counter bound to this logger's registry. */
  counter(options: Omit<MetricOptions, "registers">): Counter {
    return new Counter({ ...options, registers: [this.metricsRegistry()] });
  }

  /** Create a gauge bound to this logger's registry. */
  gauge(options: Omit<MetricOptions, "registers">): Gauge {
    return new Gauge({ ...options, registers: [this.metricsRegistry()] });
  }

  /** Create a histogram bound to this logger's registry. */
  histogram(
    options: Omit<MetricOptions, "registers"> & { buckets?: readonly number[] },
  ): Histogram {
    return new Histogram({ ...options, registers: [this.metricsRegistry()] });
  }

  /** All logger metrics in Prometheus text format, ready for a /metrics endpoint. */
  metricsText(): string {
    return this.metricsRegistryInstance?.metrics() ?? "";
  }

  /**
   * Render every metric of this logger's registry as an ASCII-framed table
   * and write it at the given level. Pretty console shows the frame; JSON,
   * file and database transports receive the same plain-text table.
   */
  metricsBox(level: LogLevel = "info"): void {
    const snapshots = this.metricsRegistryInstance?.snapshots() ?? [];
    const body =
      snapshots.length === 0 ? ["no metrics recorded"] : renderMetricsTable(snapshots).split("\n");
    this.write(level, drawBox(body, { title: "metrics" }).join("\n"));
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

  trace(message: LazyMessage, context?: LazyContext): void;
  trace(context: LogContext, message?: string): void;
  trace(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_TRACE < this.levelThreshold) return;
    this.writeNormalized("trace", first, second);
  }

  debug(message: LazyMessage, context?: LazyContext): void;
  debug(context: LogContext, message?: string): void;
  debug(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_DEBUG < this.levelThreshold) return;
    this.writeNormalized("debug", first, second);
  }

  info(message: LazyMessage, context?: LazyContext): void;
  info(context: LogContext, message?: string): void;
  info(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_INFO < this.levelThreshold) return;
    this.writeNormalized("info", first, second);
  }

  success(message: LazyMessage, context?: LazyContext): void;
  success(context: LogContext, message?: string): void;
  success(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_SUCCESS < this.levelThreshold) return;
    this.writeNormalized("success", first, second);
  }

  warn(message: LazyMessage, context?: LazyContext): void;
  warn(context: LogContext, message?: string): void;
  warn(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_WARN < this.levelThreshold) return;
    this.writeNormalized("warn", first, second);
  }

  error(message: LazyMessage, context?: LazyContext): void;
  error(context: LogContext, message?: string): void;
  error(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_ERROR < this.levelThreshold) return;
    this.writeNormalized("error", first, second);
  }

  fatal(message: LazyMessage, context?: LazyContext): void;
  fatal(context: LogContext, message?: string): void;
  fatal(first: LazyMessage | LogContext, second?: LazyContext | string): void {
    if (LEVEL_FATAL < this.levelThreshold) return;
    this.writeNormalized("fatal", first, second);
  }

  private writeMeasured(
    name: string,
    durationMs: number,
    options: TimeOptions = {},
    spanContext?: { spanId: string; traceId: string; parentId?: string },
  ): void {
    const slow = options.maxMs !== undefined && durationMs > options.maxMs;
    const level = slow ? "warn" : (options.level ?? "success");
    this.profiler?.record(name, durationMs);
    this.write(level, `${name} completed in ${formatDuration(durationMs)}`, {
      durationMs,
      operation: name,
      ...(slow ? { maxMs: options.maxMs, slow: true } : {}),
      ...spanContext,
    });
    if (spanContext !== undefined) {
      getSpanRegistry().add({
        durationMs,
        level,
        message: `${name} completed in ${formatDuration(durationMs)}`,
        name,
        parentId: spanContext.parentId,
        spanId: spanContext.spanId,
        timestamp: this.timestamp(),
        traceId: spanContext.traceId,
      });
    }
  }

  /**
   * Measure a function and log its duration. Returns the function result.
   * Pass `maxMs` to warn when the measurement exceeds the threshold.
   */
  async time<T>(name: string, fn: () => Promise<T> | T, options: TimeOptions = {}): Promise<T> {
    const startedAt = performance.now();
    const outcome = await attemptAsync(() => fn());
    const durationMs = Math.round(performance.now() - startedAt);
    this.writeMeasured(name, durationMs, options);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
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
    const thirdIsCallback = typeof maybeCallback === "function";
    const isCallback = typeof optionsOrCallback === "function";
    const options: TimeOptions = isCallback ? {} : (optionsOrCallback ?? {});
    let callback: ((span: SpanHandle) => T | Promise<T>) | undefined;
    if (thirdIsCallback) {
      callback = maybeCallback;
    } else if (isCallback) {
      callback = optionsOrCallback as (span: SpanHandle) => T | Promise<T>;
    }
    const spanContext = inheritSpanContext(getAsyncContext(), options);
    const { parentId, spanId, traceId } = spanContext;
    const startedAt = performance.now();
    const stub: SpanHandle = {
      end: () => {
        throw new Error("span.end called before initialization");
      },
      ended: false,
      parentId,
      spanId,
      traceId,
    };
    const handle: SpanHandle = stub;

    handle.end = (level?: LogLevel): void => {
      if (handle.ended) return;
      handle.ended = true;
      const durationMs = Math.round(performance.now() - startedAt);
      this.writeMeasured(
        name,
        durationMs,
        { ...options, level: level ?? options.level },
        spanContext,
      );
    };

    if (callback === undefined) return handle;

    return runWithSpanPath(name, () =>
      runWithContext({ ...spanContext }, async () => {
        try {
          const result = (await callback(handle)) as T;
          if (handle.ended) return result;
          handle.end();
          return result;
        } catch (error: unknown) {
          if (handle.ended) throw error;
          handle.end("error");
          throw error;
        }
      }),
    );
  }

  /** Render the span tree for a trace (default: most recent) as an ASCII tree. */
  traceTree(traceId?: string): void {
    const registry = getSpanRegistry();
    const id = traceId ?? registry.latestTraceId();
    if (id === undefined) {
      this.write("info", "no spans recorded");
      return;
    }
    const roots = registry.treeForTrace(id);
    if (roots.length === 0) {
      this.write("info", `no spans for trace ${id}`);
      return;
    }
    this.write("info", renderSpanTree(roots));
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
    const isCallback = typeof optionsOrCallback === "function";
    const options: TaskOptions = isCallback ? {} : (optionsOrCallback ?? {});
    const callback = isCallback
      ? (optionsOrCallback as (task: TaskHandle) => T | Promise<T>)
      : undefined;

    const inherited = getAsyncContext();
    const prefix = typeof inherited?.group === "string" ? (inherited.group as string) : "";
    const ownGroup = `${prefix}${name}`;
    // Trailing dot is load-bearing: it makes child entries indent one level deeper.
    const childGroup = `${ownGroup}.`;

    const spanContext = inheritSpanContext(inherited);

    const taskLevel: LogLevel = options.level ?? this.currentSettings.task.level;
    const progressEnabled = this.currentSettings.task.progress;
    const startedAt = performance.now();
    const state = { frame: 0, open: true };

    const finish = (ok: boolean, detail?: string | Error): void => {
      if (state.open) {
        state.open = false;
        const durationMs = Math.round(performance.now() - startedAt);
        const error = detail instanceof Error ? detail : undefined;
        const suffix =
          detail === undefined ? "" : ` - ${error === undefined ? detail : error.message}`;
        const message = ok
          ? `${name} done in ${formatDuration(durationMs)}${suffix}`
          : `${name} failed in ${formatDuration(durationMs)}${suffix}`;
        const level: LogLevel = ok ? "success" : "error";
        this.profiler?.record(name, durationMs);
        this.write(level, message, {
          durationMs,
          ...(error === undefined ? {} : { error }),
          group: ownGroup,
          operation: name,
          ...spanContext,
          status: ok ? "done" : "failed",
          task: name,
        });
        getSpanRegistry().add({
          durationMs,
          level,
          message,
          name,
          parentId: spanContext.parentId,
          spanId: spanContext.spanId,
          timestamp: this.timestamp(),
          traceId: spanContext.traceId,
        });
      }
    };

    const handle: TaskHandle = {
      done: (detail?: string): void => {
        finish(true, detail);
      },
      get ended() {
        return state.open === false;
      },
      fail: (detail?: string | Error): void => {
        finish(false, detail);
      },
      update: (text: string, context?: LogContext): void => {
        if (progressEnabled && state.open) {
          this.write(taskLevel, text, {
            frame: state.frame,
            group: childGroup,
            status: "progress",
            task: name,
            ...context,
          });
          state.frame += 1;
        }
      },
    };

    this.write(taskLevel, `${name} started`, {
      group: ownGroup,
      ...spanContext,
      status: "started",
      task: name,
    });

    if (callback === undefined) return handle;

    return runWithSpanPath(name, () =>
      runWithContext({ ...spanContext, group: childGroup }, async () => {
        try {
          const result = (await callback(handle)) as T;
          finish(true);
          return result;
        } catch (error: unknown) {
          finish(false, error instanceof Error ? error : String(error));
          throw error;
        }
      }),
    );
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
    return { ...base, caches: { ...brainSnapshots(), ...own } };
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
  async dump(path?: string): Promise<string | null> {
    const target =
      path ?? (this.currentSettings.blackbox ? this.currentSettings.blackbox.path : undefined);
    const ring = this.blackboxRing;
    if (target === undefined || ring === null || ring.size === 0) return null;
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
