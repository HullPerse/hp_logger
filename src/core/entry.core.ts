import { EMPTY_CONTEXT } from "../config/context.config";
import { LOG_SCHEMA_VERSION } from "../config/writer.config";
import { serializeError } from "../redact/index.redact";
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
  if (context === EMPTY_CONTEXT) return EMPTY_CONTEXT;
  let empty = true;
  for (const _ in context) {
    empty = false;
    break;
  }
  if (empty) return EMPTY_CONTEXT;
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

const resolveLazyContext = (lazy: LazyContext | undefined): LogContext | undefined =>
  lazy === undefined ? undefined : typeof lazy === "function" ? lazy() : lazy;

const mergeGuarded = (
  staticContext: LogContext,
  hasStaticContext: boolean,
  lazyContext: LogContext | undefined,
  asyncContext: LogContext | undefined,
): LogContext => {
  try {
    return mergeEntryContext(staticContext, hasStaticContext, lazyContext, asyncContext);
  } catch {
    return { contextError: "unserializable context" };
  }
};

const withMixin = (
  finalContext: LogContext,
  mixin: ((context: LogContext, level: LogLevel) => LogContext) | undefined,
  level: LogLevel,
): LogContext => {
  if (mixin === undefined) return finalContext;
  let injected: LogContext | undefined;
  try {
    const outcome: unknown = mixin(finalContext, level);
    injected = typeof outcome === "object" && outcome !== null ? (outcome as LogContext) : undefined;
  } catch {
    if (!mixinThrowWarned) {
      mixinThrowWarned = true;
      console.warn("hp_logger: settings.mixin threw - its fields are skipped");
    }
    injected = undefined;
  }
  if (injected !== undefined) {
    let hasKeys = false;
    for (const _ in injected) {
      hasKeys = true;
      break;
    }
    if (hasKeys) return { ...injected, ...finalContext };
  }
  return finalContext;
};

const finalizeEntry = (
  state: LoggerState,
  level: LogLevel,
  message: string,
  context: LogContext,
): LogEntry => {
  const entry: LogEntry = {
    author: state.author,
    context,
    level,
    message,
    timestamp: state.timestamp(),
  };
  if (state.schemaVersion) entry.v = LOG_SCHEMA_VERSION;
  const spanPath = getActiveSpanPath();
  if (spanPath !== undefined && spanPath.length > 0) entry.spanPath = spanPath;
  return entry;
};


/** Build one entry from a message and context, or null when a filter drops it. */
export const buildEntry = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  lazyContext: LazyContext | undefined,
): LogEntry | null => {
  const { filters, hasFilters, maxMessageLength, needsRedaction, redactValue } = state;
  const safeMessage = sanitizeMessage(message, needsRedaction, redactValue, maxMessageLength);
  const resolvedContext = resolveLazyContext(lazyContext);
  let finalContext = mergeGuarded(state.context, state.hasStaticContext, resolvedContext, getAsyncContext());
  finalContext = withMixin(finalContext, state.mixin, level);
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
  const entry = finalizeEntry(state, level, safeMessage, entryContext);
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
  const safeMessage =
    text.length > state.maxMessageLength ? text.slice(0, state.maxMessageLength) : text;
  const resolvedContext = resolveLazyContext(lazyContext);
  const finalContext = mergeGuarded(
    state.context,
    state.hasStaticContext,
    resolvedContext,
    getAsyncContext(),
  );
  const entryContext = serializeErrorKeys(
    level === "fatal" ? attachFatalSnapshot(finalContext) : finalContext,
  );
  return finalizeEntry(state, level, safeMessage, entryContext);
};
