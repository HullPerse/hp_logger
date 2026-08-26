import { EMPTY_CONTEXT } from "../config/context.config";
import { LOG_SCHEMA_VERSION } from "../config/writer.config";
import type {
  LazyContext,
  LazyMessage,
  LogContext,
  LogEntry,
  LogLevel,
  LoggerState,
} from "../types/logger";
import { getActiveSpanPath, getAsyncContext, mergeEntryContext } from "./context.core";
import { isFiltered } from "./filter.core";
import { serializeError } from "../redact/index.redact";

/**
 * Expand top-level Error values before any feature branch so JSON output
 * always carries name/message/stack/cause regardless of redaction settings
 * (a raw Error stringifies to {} because its fields are non-enumerable).
 */
const serializeErrorKeys = (context: LogContext): LogContext => {
  const { error, reason } = context;
  if (!(error instanceof Error) && !(reason instanceof Error)) return context;
  const next: LogContext = { ...context };
  if (error instanceof Error) next.error = serializeError(error);
  if (reason instanceof Error) next.reason = serializeError(reason);
  return next;
};

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

let mixinThrowWarned = false;

const sanitizeContext = (
  context: LogContext,
  needsRedaction: boolean,
  redactValue: (value: unknown) => unknown,
): LogContext => {
  if (context === EMPTY_CONTEXT || Object.keys(context).length === 0) return EMPTY_CONTEXT;
  if (!needsRedaction) return context;
  return redactValue(context) as LogContext;
};

/** Per-key transformers (pino-style serializers), applied before redaction. */
const applySerializers = (
  context: LogContext,
  serializers: Record<string, (value: unknown) => unknown> | undefined,
): LogContext => {
  if (serializers === undefined) return context;
  const result: LogContext = { ...context };
  for (const [key, transform] of Object.entries(serializers)) {
    if (key in result) {
      try {
        result[key] = transform(result[key]);
      } catch {
        result[key] = "[SERIALIZER ERROR]";
      }
    }
  }
  return result;
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
    mixin,
    needsRedaction,
    redactValue,
    schemaVersion,
  } = state;

  const safeMessage = sanitizeMessage(message, needsRedaction, redactValue, maxMessageLength);

  let resolvedContext: LogContext | undefined;
  if (lazyContext !== undefined) {
    resolvedContext = typeof lazyContext === "function" ? lazyContext() : lazyContext;
  }
  let finalContext: LogContext;
  try {
    finalContext = mergeEntryContext(context, hasStaticContext, resolvedContext, getAsyncContext());
  } catch {
    // Hostile context (throwing getters) still logs, with a marker instead.
    finalContext = { contextError: "unserializable context" };
  }
  // Mixin fields sit under explicit data: the spread order makes call-site
  // and async context win. A throwing mixin contributes nothing, and so does
  // a non-object return; the first throw warns once so bugs stay visible.
  if (mixin !== undefined) {
    let injected: LogContext | undefined;
    try {
      const outcome: unknown = mixin(finalContext, level);
      injected =
        typeof outcome === "object" && outcome !== null ? (outcome as LogContext) : undefined;
    } catch {
      if (!mixinThrowWarned) {
        mixinThrowWarned = true;
        console.warn("hp_logger: settings.mixin threw - its fields are skipped");
      }
      injected = undefined;
    }
    if (injected !== undefined && Object.keys(injected).length > 0) {
      finalContext = { ...injected, ...finalContext };
    }
  }
  let safeContext: LogContext;
  try {
    safeContext = sanitizeContext(
      serializeErrorKeys(applySerializers(finalContext, state.serializers)),
      needsRedaction,
      redactValue,
    );
  } catch {
    safeContext = { contextError: "unserializable context" };
  }
  const entryContext = level === "fatal" ? attachFatalSnapshot(safeContext) : safeContext;

  const entry: LogEntry = {
    author,
    context: entryContext,
    level,
    message: safeMessage,
    timestamp: state.timestamp(),
  };
  if (schemaVersion) entry.v = LOG_SCHEMA_VERSION;
  // Logger-generated metadata, outside context so redaction never masks it.
  const spanPath = getActiveSpanPath();
  if (spanPath !== undefined && spanPath.length > 0) entry.spanPath = spanPath;

  if (hasFilters && isFiltered(filters, entry)) return null;
  return entry;
};

/**
 * Specialized builder for loggers with redaction, serializers, mixin,
 * filters, and schema stamping all off: same output as buildEntry for those
 * states, minus the per-entry feature branches. Selected once per settings
 * change in applyHotSettings, not per entry.
 */
export const buildEntryFast = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  lazyContext: LazyContext | undefined,
): LogEntry | null => {
  const raw = typeof message === "function" ? message() : message;
  const text = typeof raw === "string" ? raw : String(raw);
  const { maxMessageLength } = state;
  const safeMessage = text.length > maxMessageLength ? text.slice(0, maxMessageLength) : text;

  let resolvedContext: LogContext | undefined;
  if (lazyContext !== undefined) {
    resolvedContext = typeof lazyContext === "function" ? lazyContext() : lazyContext;
  }
  let finalContext: LogContext;
  try {
    finalContext = mergeEntryContext(
      state.context,
      state.hasStaticContext,
      resolvedContext,
      getAsyncContext(),
    );
  } catch {
    // Hostile context (throwing getters) still logs, with a marker instead.
    finalContext = { contextError: "unserializable context" };
  }
  const entryContext = serializeErrorKeys(
    level === "fatal" ? attachFatalSnapshot(finalContext) : finalContext,
  );

  const entry: LogEntry = {
    author: state.author,
    context: entryContext,
    level,
    message: safeMessage,
    timestamp: state.timestamp(),
  };
  const spanPath = getActiveSpanPath();
  if (spanPath !== undefined && spanPath.length > 0) entry.spanPath = spanPath;
  return entry;
};
