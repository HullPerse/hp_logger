import { EMPTY_CONTEXT } from "../config/context.config";

import type {
  LazyContext,
  LazyMessage,
  LogContext,
  LogEntry,
  LogLevel,
  LoggerState,
} from "../types/logger";
import { getAsyncContext, mergeEntryContext } from "./context.core";
import { isFiltered } from "./filter.core";

const sanitizeMessage = (
  message: LazyMessage,
  needsRedaction: boolean,
  redactValue: (value: unknown) => unknown,
  maxMessageLength: number,
): string => {
  const raw = typeof message === "function" ? message() : message;
  // With redaction disabled, a plain string keeps the no-copy fast path.
  if (!needsRedaction && typeof raw === "string") return raw;
  const redacted = redactValue(raw);
  const text = typeof redacted === "string" ? redacted : String(redacted);
  return text.length > maxMessageLength ? text.slice(0, maxMessageLength) : text;
};

const sanitizeContext = (
  context: LogContext,
  needsRedaction: boolean,
  redactValue: (value: unknown) => unknown,
): LogContext => {
  if (context === EMPTY_CONTEXT || Object.keys(context).length === 0) return EMPTY_CONTEXT;
  if (!needsRedaction) return context;
  return redactValue(context) as LogContext;
};

/** Memory and uptime snapshot appended to every fatal entry. */
const attachFatalSnapshot = (context: LogContext): LogContext => {
  const usage = process.memoryUsage();
  return {
    ...context,
    memory: {
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      rss: usage.rss,
    },
    uptimeMs: Math.round(process.uptime() * 1000),
  };
};

/** Build one entry from a message and context, or null when a filter drops it. */
export const buildEntry = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  lazyContext: LazyContext | undefined,
): LogEntry | null => {
  const {
    author,
    context,
    filters,
    hasFilters,
    hasStaticContext,
    maxMessageLength,
    needsRedaction,
    redactValue,
  } = state;

  const safeMessage = sanitizeMessage(message, needsRedaction, redactValue, maxMessageLength);

  let resolvedContext: LogContext | undefined;
  if (lazyContext !== undefined) {
    resolvedContext = typeof lazyContext === "function" ? lazyContext() : lazyContext;
  }
  const finalContext = mergeEntryContext(
    context,
    hasStaticContext,
    resolvedContext,
    getAsyncContext(),
  );
  const safeContext = sanitizeContext(finalContext, needsRedaction, redactValue);
  // Rare level: attach the process state to the last line before exit.
  const entryContext = level === "fatal" ? attachFatalSnapshot(safeContext) : safeContext;

  const entry: LogEntry = {
    author,
    context: entryContext,
    level,
    message: safeMessage,
    timestamp: state.timestamp(),
  };

  if (hasFilters && isFiltered(filters, entry)) return null;
  return entry;
};
