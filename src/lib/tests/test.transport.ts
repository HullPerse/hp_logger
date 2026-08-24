import { DEFAULT_AUTHOR } from "@/config/logger.config";
import { Logger } from "@/index.logger";
import { resolveSettings } from "@/lib/settings.utils";
import type { LogEntry, LoggerSettings } from "@/types/logger";
import type { Transport } from "@/types/transport";
import { AsyncTransport } from "@/writer/buffer.writer";

export const createTestTransport = (): { entries: LogEntry[]; transport: Transport } => {
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

export const captureLogger = (
  settings: LoggerSettings = {},
): { entries: LogEntry[]; logger: Logger; transport: Transport } => {
  const captured = createTestTransport();
  const transport = settings.batching
    ? new AsyncTransport(captured.transport, settings.batching)
    : captured.transport;
  const logger = new Logger(
    DEFAULT_AUTHOR,
    resolveSettings(settings),
    {},
    settings.watch,
    transport,
  );
  return { entries: captured.entries, logger, transport };
};

interface CapturedConsole {
  outputs: string[];
  restore: () => void;
}

export const captureConsole = (): CapturedConsole => {
  const outputs: string[] = [];
  const original = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const capture = (...values: unknown[]): void => {
    outputs.push(values.map(String).join(" "));
  };
  console.debug = capture;
  console.error = capture;
  console.log = capture;
  console.warn = capture;
  return {
    outputs,
    restore: () => {
      console.debug = original.debug;
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
  };
};

const silentConsole = (): void => undefined;

export const withMutedConsole = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const original = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.debug = silentConsole;
  console.error = silentConsole;
  console.log = silentConsole;
  console.warn = silentConsole;
  try {
    return await fn();
  } finally {
    console.debug = original.debug;
    console.error = original.error;
    console.log = original.log;
    console.warn = original.warn;
  }
};
