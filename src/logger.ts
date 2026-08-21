import type {
  LogContext,
  LogEntry,
  LoggerSettings,
  LogLevel,
  ResolvedSettings,
  Transport,
} from './types';
import { mergeSettings, resolveSettings } from './types';
import { formatTimestamp, redact, resolveEnvLevel, shouldLog } from './utils';
import { buildTransports } from './transports/factory';

export class Logger {
  private readonly author: string;
  private context: LogContext;
  private currentSettings: ResolvedSettings;
  private transport: Transport;

  constructor(
    author: string,
    currentSettings: ResolvedSettings,
    context: LogContext = {}
  ) {
    this.author = author;
    this.context = context;
    this.currentSettings = currentSettings;
    this.transport = buildTransports(currentSettings);
  }

  /** Override settings for this logger and all its descendants. */
  settings(patch: LoggerSettings): this {
    this.currentSettings = mergeSettings(this.currentSettings, patch);
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

  event(level: LogLevel, eventName: string, context: LogContext = {}): void {
    this.write(level, eventName, { event: eventName, ...context });
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  success(message: string, context?: LogContext): void {
    this.write('success', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.currentSettings.enabled) return;
    if (!shouldLog(level, this.currentSettings.level)) return;

    const safeMessage = String(
      redact(message, this.currentSettings.redactKeys, this.currentSettings.redactDepth)
    ).slice(0, this.currentSettings.maxMessageLength);
    const mergedContext = { ...this.context, ...context };
    const safeContext =
      Object.keys(mergedContext).length > 0
        ? (redact(
            mergedContext,
            this.currentSettings.redactKeys,
            this.currentSettings.redactDepth
          ) as LogContext)
        : {};

    const entry: LogEntry = {
      author: this.author,
      context: safeContext,
      level,
      message: safeMessage,
      timestamp: formatTimestamp(this.currentSettings.formatTimestamp),
    };

    if (this.currentSettings.filters.some((filter) => !filter(entry))) return;

    this.transport.write(entry);
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

export const installGlobalErrorHandlers = (logger: Logger): void => {
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', { error });
  });
};
