import { Logger } from "../api/logger.api.js";
import { DEFAULT_AUTHOR } from "../config/logger.config.js";
import { resolveSettings } from "../lib/settings.utils.js";
import type { LogEntry, LogLevel, LoggerSettings } from "../types/logger.js";
import type { Transport } from "../types/transport.js";
import { AsyncTransport } from "../writer/buffer.writer.js";

/** In-memory transport for tests: every entry lands in `entries`. */
export const createCaptureTransport = (): { entries: LogEntry[]; transport: Transport } => {
  const entries: LogEntry[] = [];
  return {
    entries,
    transport: {
      write: (entry) => {
        entries.push(entry);
      },
    },
  };
};

/** A logger wired to an in-memory capture transport, plus the captured entries. */
export const captureLogger = (
  settings: LoggerSettings = {},
  envModuleLevels?: Map<string, LogLevel>,
): { entries: LogEntry[]; logger: Logger; transport: Transport } => {
  const captured = createCaptureTransport();
  const transport = settings.batching
    ? new AsyncTransport(captured.transport, settings.batching)
    : captured.transport;
  const logger = new Logger(
    DEFAULT_AUTHOR,
    resolveSettings(settings),
    {},
    settings.watch,
    transport,
    envModuleLevels,
  );
  return { entries: captured.entries, logger, transport };
};

interface MutedConsole {
  restore: () => void;
}

const silent = (): void => undefined;

const muteConsole = (): MutedConsole => {
  const original = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.debug = silent;
  console.error = silent;
  console.log = silent;
  console.warn = silent;
  return {
    restore: () => {
      console.debug = original.debug;
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
  };
};

/** Run a callback with the console muted (success and failure paths restore). */
export const withMutedConsole = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const muted = muteConsole();
  try {
    return await fn();
  } finally {
    muted.restore();
  }
};
