import { getAsyncContext, runMeasuredScope } from "../core/context.core.js";
import { getSpanRegistry, inheritSpanContext } from "../core/span.core.js";
import { formatDuration } from "../format/duration.format.js";
import type { LogContext, LogLevel, TaskHandle, TaskOptions } from "../types/logger.js";

export const taskImpl = <T>(
  logger: unknown,
  name: string,
  optionsOrCallback?: TaskOptions | ((task: TaskHandle) => T | Promise<T>),
): TaskHandle | Promise<T> => {
  const self = logger as {
    write: (level: LogLevel, message: string, context: Record<string, unknown>) => void;
    timestamp: () => string;
    profiler: { record: (name: string, durationMs: number) => void } | null;
    currentSettings: { task: { level: LogLevel; progress: boolean } };
  };
  const isCallback = typeof optionsOrCallback === "function";
  const options: TaskOptions = isCallback ? {} : (optionsOrCallback ?? {});
  const callback = isCallback
    ? (optionsOrCallback as (task: TaskHandle) => T | Promise<T>)
    : undefined;

  const inherited = getAsyncContext();
  const prefix = typeof inherited?.group === "string" ? (inherited.group as string) : "";
  const ownGroup = `${prefix}${name}`;
  const childGroup = `${ownGroup}.`;

  const spanContext = inheritSpanContext(inherited);

  const taskLevel: LogLevel = options.level ?? self.currentSettings.task.level;
  const progressEnabled = self.currentSettings.task.progress;
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
      self.profiler?.record(name, durationMs);
      self.write(level, message, {
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
        timestamp: self.timestamp(),
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
        self.write(taskLevel, text, {
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

  self.write(taskLevel, `${name} started`, {
    group: ownGroup,
    ...spanContext,
    status: "started",
    task: name,
  });

  if (callback === undefined) return handle;

  return runMeasuredScope(name, { ...spanContext, group: childGroup }, handle, callback, (_task, ok, detail) =>
    finish(ok, detail),
  );
};
