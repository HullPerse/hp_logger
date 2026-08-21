import { LOG_LEVELS } from './types';
import type { ContextFormat, EntryFormatter, LogContext, LogEntry, LogLevel, TimestampFormat } from './types';

const BEARER_PATTERN = /bearer\s+[^\s]+/giu;
const KEY_VALUE_PATTERN = /(?<key>password|token|secret|authorization|cookie)=?[^\s,;]+/giu;

/**
 * Fast pre-filter for redaction: keys containing any of these fragments
 * can carry secrets. Used to skip the deep-copy scan when a context object
 * has no candidate keys at all.
 */
const SENSITIVE_KEY_FRAGMENTS =
  /(?:password|token|secret|authorization|cookie|drawing|replay|chat|payload)/iu;

const serializeError = (error: Error): Record<string, unknown> => {
  const result: Record<string, unknown> = { message: error.message, name: error.name };
  if (error.stack) result.stack = error.stack;
  if (error.cause !== undefined) {
    result.cause =
      error.cause instanceof Error ? serializeError(error.cause) : error.cause;
  }
  return result;
};

export const redact = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth = 2,
  depth = 0
): unknown => {
  if (depth > maxDepth) return '[REDACTED]';

  if (value instanceof Error) return serializeError(value);

  if (typeof value === 'string') {
    if (secretKey === null) return value;
    return value
      .replaceAll(BEARER_PATTERN, 'Bearer [REDACTED]')
      .replaceAll(KEY_VALUE_PATTERN, '$<key>=[REDACTED]');
  }

  if (Array.isArray(value)) return `[${value.length} items]`;

  if (typeof value === 'object' && value !== null) {
    // Fast path: no candidate keys and no nested objects/Errors to
    // serialize -> nothing to mask, return as-is without copying.
    if (secretKey === null) return value;
    const keys = Object.keys(value);
    const hasNested = keys.some((key) => {
      const nested: unknown = (value as Record<string, unknown>)[key];
      return typeof nested === 'object' && nested !== null;
    });
    if (!keys.some((key) => SENSITIVE_KEY_FRAGMENTS.test(key)) && !hasNested) {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = secretKey.test(key)
        ? '[REDACTED]'
        : redact(nested, secretKey, maxDepth, depth + 1);
    }
    return result;
  }

  return value;
};

export const formatContext = (
  context: LogContext,
  format: ContextFormat
): string => {
  if (Object.keys(context).length === 0) return '';
  if (format === 'json') return ` ${JSON.stringify(context)}`;
  const pairs = Object.entries(context).map(([key, value]) => {
    const rendered =
      typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
    return `${key}=${rendered}`;
  });
  return ` ${pairs.join(' ')}`;
};

export const formatEntry = (
  entry: LogEntry,
  mode: 'json' | 'pretty',
  contextFormat: ContextFormat = 'json',
  formatter?: EntryFormatter
): string => {
  if (mode === 'json') return JSON.stringify(entry);
  if (formatter) return formatter(entry);
  return `[${entry.timestamp}] [${entry.author}] [${entry.level.toUpperCase()}] ${entry.message}${formatContext(entry.context, contextFormat)}`;
};

const pad = (n: number): string => String(n).padStart(2, '0');

export const formatTimestamp = (format: TimestampFormat): string => {
  if (format === 'local') {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
};

export const shouldLog = (
  level: LogLevel,
  configuredLevel: LogLevel
): boolean => LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];

export const resolveEnvLevel = (
  env: Record<string, string | undefined> = process.env
): LogLevel => {
  const value = env.LOG_LEVEL;
  return value && value in LOG_LEVELS ? (value as LogLevel) : 'info';
};

export const formatDuration = (durationMs: number): string =>
  durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(2)}s`
    : `${Math.round(durationMs)}ms`;
