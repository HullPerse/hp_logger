import { safeStringify } from "../lib/json.utils";
import type { LogLevel } from "../types/logger";
import { isLoggerWriting } from "../writer/console.writer";
import type { Logger } from "./logger.api";

/** Handle returned by `captureConsole` - call `restore()` to undo. */
export interface ConsoleCaptureHandle {
  restore: () => void;
}

type NativeMethod = (...args: unknown[]) => void;

const LEVEL_BY_METHOD: Record<string, LogLevel> = {
  debug: "debug",
  error: "error",
  info: "info",
  log: "info",
  trace: "trace",
  warn: "warn",
};

const consoleHost = console as unknown as Record<string, NativeMethod | undefined>;

const formatArg = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  return safeStringify(arg);
};

/**
 * Route console.log/info/warn/error/debug/trace through the logger, so
 * chatty dependencies land in files, databases and transports with real
 * levels. The logger's own output bypasses the capture (native methods are
 * bound at import time), so there is no recursion. Returns a handle whose
 * restore() puts the original console back.
 */
export const captureConsole = (logger: Logger): ConsoleCaptureHandle => {
  const originals = new Map<string, NativeMethod>();
  const routed = new Map<string, NativeMethod>();

  for (const [method, level] of Object.entries(LEVEL_BY_METHOD)) {
    const native = consoleHost[method];
    if (typeof native !== "function") continue;
    originals.set(method, native);
    routed.set(method, (...args: unknown[]) => {
      // The logger's own output steps aside: print it natively, no re-entry.
      if (isLoggerWriting()) {
        const original = originals.get(method) as NativeMethod;
        original(...args);
        return;
      }
      logger.logEvent(level, args.map(formatArg).join(" "));
    });
  }
  for (const [method, fn] of routed) consoleHost[method] = fn;

  return {
    restore: (): void => {
      for (const [method, native] of originals) {
        if (consoleHost[method] === routed.get(method)) consoleHost[method] = native;
      }
    },
  };
};
