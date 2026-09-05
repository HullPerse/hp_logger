import { getAsyncContext, runMeasuredScope } from "../core/context.core";
import { getSpanRegistry, inheritSpanContext } from "../core/span.core";
import { formatDuration } from "../format/duration.format";
import { renderSpanTree } from "../format/span.format";
import { attemptAsync } from "../lib/result.utils";
import type { LogLevel, SpanHandle, TimeOptions } from "../types/logger";

const writeMeasured = (
  logger: unknown,
  name: string,
  durationMs: number,
  options: TimeOptions = {},
  spanContext?: { spanId: string; traceId: string; parentId?: string },
): void => {
  const self = logger as {
    write: (level: LogLevel, message: string, context: Record<string, unknown>) => void;
    timestamp: () => string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profiler: { record: (name: string, durationMs: number) => void } | null;
  };
  const slow = options.maxMs !== undefined && durationMs > options.maxMs;
  const level = slow ? "warn" : ((options.level ?? "success") as LogLevel);
  self.profiler?.record(name, durationMs);
  self.write(level, `${name} completed in ${formatDuration(durationMs)}`, {
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
      timestamp: self.timestamp(),
      traceId: spanContext.traceId,
    });
  }
};

export const timeImpl = async <T>(
  logger: unknown,
  name: string,
  fn: () => Promise<T> | T,
  options: TimeOptions = {},
): Promise<T> => {
  const startedAt = performance.now();
  const outcome = await attemptAsync(() => fn());
  const durationMs = Math.round(performance.now() - startedAt);
  writeMeasured(logger, name, durationMs, options);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};

export const spanImpl = <T>(
  logger: unknown,
  name: string,
  optionsOrCallback?: TimeOptions | ((span: SpanHandle) => T | Promise<T>),
  maybeCallback?: (span: SpanHandle) => T | Promise<T>,
): SpanHandle | Promise<T> => {
  const thirdIsCallback = typeof maybeCallback === "function";
  const isCallback = typeof optionsOrCallback === "function";
  const options: TimeOptions = isCallback ? {} : ((optionsOrCallback as TimeOptions) ?? {});
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
    writeMeasured(
      logger,
      name,
      durationMs,
      { ...options, level: level ?? options.level },
      spanContext,
    );
  };

  if (callback === undefined) return handle;

  return runMeasuredScope(name, { ...spanContext }, handle, callback, (span, ok) => {
    if (!span.ended) span.end(ok ? undefined : "error");
  });
};

export const traceTreeImpl = (logger: unknown, traceId?: string): void => {
  const self = logger as {
    write: (level: LogLevel, message: string, context?: unknown) => void;
  };
  const registry = getSpanRegistry();
  const id = traceId ?? registry.latestTraceId();
  if (id === undefined) {
    self.write("info", "no spans recorded");
    return;
  }
  const roots = registry.treeForTrace(id);
  if (roots.length === 0) {
    self.write("info", `no spans for trace ${id}`);
    return;
  }
  self.write("info", renderSpanTree(roots));
};
