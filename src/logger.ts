import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  LazyContext,
  LazyMessage,
  LogContext,
  LogEntry,
  LoggerSettings,
  LogLevel,
  ResolvedSettings,
  Transport,
} from './types';
import { LOG_LEVELS, mergeSettings, resolveSettings } from './types';
import { formatDuration, formatTimestamp, redact, resolveEnvLevel } from './utils';
import { buildTransports } from './transports/factory';

const asyncStorage = new AsyncLocalStorage<LogContext>();

const globalTransports: Transport[] = [];

const rateLimits = new Map<string, number>();
const onceKeys = new Set<string>();

const resolveLazy = <T>(value: T | (() => T)): T =>
  typeof value === 'function' ? (value as () => T)() : value;

const EMPTY_CONTEXT: LogContext = {};

/** ISO timestamp, computed at most once per second (cheap in hot loops). */
const cachedTimestamp = (): string => {
  const now = Math.floor(Date.now() / 1000);
  if (cachedTimestamp.second === now) return cachedTimestamp.value;
  cachedTimestamp.second = now;
  cachedTimestamp.value = new Date(now * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return cachedTimestamp.value;
};
cachedTimestamp.second = 0;
cachedTimestamp.value = '';

/** Numeric level of a named level, precomputed for the hot path. */
const LEVEL_NUMBER = (level: LogLevel): number => LOG_LEVELS[level];

export class Logger {
  private readonly author: string;
  private context: LogContext;
  private currentSettings: ResolvedSettings;
  private levelThreshold: number;
  private transport: Transport;

  constructor(
    author: string,
    currentSettings: ResolvedSettings,
    context: LogContext = {}
  ) {
    this.author = author;
    this.context = context;
    this.currentSettings = currentSettings;
    this.levelThreshold = LEVEL_NUMBER(currentSettings.level);
    this.transport = buildTransports(currentSettings);
  }

  /** Override settings for this logger and all its descendants. */
  settings(patch: LoggerSettings): this {
    this.currentSettings = mergeSettings(this.currentSettings, patch);
    this.levelThreshold = LEVEL_NUMBER(this.currentSettings.level);
    this.transport = buildTransports(this.currentSettings);
    return this;
  }

  /** Create a named child module with optional settings override. */
  module(name: string, patch?: LoggerSettings): Logger {
    const settings = patch
      ? mergeSettings(this.currentSettings, patch)
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
    return this;
  }

  /** Run a function with an async-local context merged into every entry. */
  run<T>(context: LogContext, fn: () => T): T {
    const inherited = asyncStorage.getStore();
    return asyncStorage.run(
      { ...inherited, ...this.context, ...context },
      fn
    );
  }

  event(level: LogLevel, eventName: string, context: LogContext = {}): void {
    this.write(level, eventName, { event: eventName, ...context });
  }

  trace(message: LazyMessage, context?: LazyContext): void {
    this.write('trace', message, context);
  }

  debug(message: LazyMessage, context?: LazyContext): void {
    this.write('debug', message, context);
  }

  info(message: LazyMessage, context?: LazyContext): void {
    this.write('info', message, context);
  }

  success(message: LazyMessage, context?: LazyContext): void {
    this.write('success', message, context);
  }

  warn(message: LazyMessage, context?: LazyContext): void {
    this.write('warn', message, context);
  }

  error(message: LazyMessage, context?: LazyContext): void {
    this.write('error', message, context);
  }

  fatal(message: LazyMessage, context?: LazyContext): void {
    this.write('fatal', message, context);
  }

  /** Measure a function and log its duration. Returns the function result. */
  async measure<T>(name: string, fn: () => Promise<T> | T, level: LogLevel = 'success'): Promise<T> {
    const startedAt = performance.now();
    try {
      return await fn();
    } finally {
      const durationMs = performance.now() - startedAt;
      this.write(level, `${name} completed in ${formatDuration(durationMs)}`, {
        durationMs: Math.round(durationMs),
        operation: name,
      });
    }
  }

  /** Log once per key: subsequent calls with the same key are dropped. */
  once(key: string, message: LazyMessage, context?: LazyContext): void {
    if (onceKeys.has(key)) return;
    onceKeys.add(key);
    this.write('warn', message, context);
  }

  /** Log at most once per interval: extra calls within `ms` are dropped. */
  throttle(
    key: string,
    ms: number,
    message: LazyMessage,
    context?: LazyContext,
    level: LogLevel = 'warn'
  ): void {
    const now = Date.now();
    const lastLogAt = rateLimits.get(key);
    if (lastLogAt !== undefined && now - lastLogAt < ms) return;
    rateLimits.set(key, now);
    this.write(level, message, context);
  }

  private write(level: LogLevel, message: LazyMessage, context?: LazyContext): void {
    const settings = this.currentSettings;
    if (!settings.enabled) return;
    if (LEVEL_NUMBER(level) < this.levelThreshold) return;

    const { maxMessageLength, redactDepth, redactKeys } = settings;

    // Message: plain string fast path, skip regex scanning when redaction
    // is disabled entirely.
    let safeMessage: string;
    const rawMessage = resolveLazy(message);
    if (redactKeys === null && typeof rawMessage === 'string') {
      safeMessage = rawMessage;
    } else {
      safeMessage = String(
        redact(rawMessage, redactKeys, redactDepth)
      ).slice(0, maxMessageLength);
    }

    // Context merge: skip spreading when there is nothing to merge.
    const staticContext = this.context;
    const asyncContext = asyncStorage.getStore();
    let finalContext: LogContext;
    if (context === undefined && Object.keys(staticContext).length === 0 && asyncContext === undefined) {
      finalContext = EMPTY_CONTEXT;
    } else {
      const lazyContext = context === undefined ? {} : resolveLazy(context);
      const mergedContext =
        Object.keys(staticContext).length === 0
          ? lazyContext
          : { ...staticContext, ...lazyContext };
      finalContext =
        asyncContext && Object.keys(asyncContext).length > 0
          ? { ...asyncContext, ...mergedContext }
          : mergedContext;
    }

    const safeContext =
      Object.keys(finalContext).length > 0
        ? (redact(finalContext, redactKeys, redactDepth) as LogContext)
        : EMPTY_CONTEXT;

    const entry: LogEntry = {
      author: this.author,
      context: safeContext,
      level,
      message: safeMessage,
      timestamp:
        settings.formatTimestamp === 'iso'
          ? cachedTimestamp()
          : formatTimestamp('local'),
    };

    if (settings.filters.length > 0 && settings.filters.some((filter) => !filter(entry))) return;

    this.transport.write(entry);
    for (const transport of globalTransports) {
      transport.write(entry);
    }
  }

  /** Register a transport for every logger in the process. */
  static addTransport(transport: Transport): void {
    globalTransports.push(transport);
  }

  /** Remove a previously registered global transport. */
  static removeTransport(transport: Transport): void {
    const index = globalTransports.indexOf(transport);
    if (index !== -1) globalTransports.splice(index, 1);
  }

  static clearTransports(): void {
    globalTransports.length = 0;
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export interface CreateLoggerOptions {
  /** Global settings applied to every module. */
  settings?: LoggerSettings;
  /** Optional root author for direct logging without modules. */
  author?: string;
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const settings = resolveSettings({
    ...options.settings,
    level: options.settings?.level ?? resolveEnvLevel(),
  });
  return new Logger(options.author ?? 'ROOT', settings);
};

let globalErrorHandlersInstalled = false;

export const installGlobalErrorHandlers = (logger: Logger): void => {
  if (globalErrorHandlersInstalled) return;
  globalErrorHandlersInstalled = true;
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', { error });
  });
  // Bun 1.4 emits memoryPressure when the OS runs low on memory.
  // Log it before the process gets killed, so the last lines show why.
  if (typeof process.versions.bun === 'string') {
    process.on('memoryPressure' as never, (level: string) => {
      logger.warn('memoryPressure', { level });
    });
  }
};
