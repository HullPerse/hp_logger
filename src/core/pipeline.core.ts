import type { LazyContext, LazyMessage, LogEntry, LogLevel, LoggerState } from "../types/logger";
import type { Transport } from "../types/transport";
import { buildEntry } from "./entry.core";

const globalTransports: Transport[] = [];

const dispatchSafely = async (transport: Transport, entry: LogEntry): Promise<void> => {
  try {
    await transport.write(entry);
  } catch {
    // Transport failures (sync throws and rejected promises alike) never
    // crash the application that is logging.
  }
};

export const addGlobalTransport = (transport: Transport): void => {
  globalTransports.push(transport);
};

export const removeGlobalTransport = (transport: Transport): void => {
  const index = globalTransports.indexOf(transport);
  if (index !== -1) globalTransports.splice(index, 1);
};

export const clearGlobalTransports = (): void => {
  globalTransports.length = 0;
};

/** Route one entry through the pipeline: build, filter, black box, dispatch. */
export const writeEntry = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  context: LazyContext | undefined,
): void => {
  if (!state.enabled) return;
  let entry: LogEntry | null = null;
  try {
    entry = buildEntry(state, level, message, context);
  } catch {
    // Hostile context (throwing getters, toJSON) never crashes the caller.
    return;
  }
  if (entry === null) return;
  state.blackbox?.push(entry);
  // Sampling sits after the black box: the flight recorder keeps everything,
  // only the transports are sampled. error/fatal always pass.
  const sampledIn =
    state.sampler === undefined || entry.level === "error" || entry.level === "fatal"
      ? true
      : state.sampler(entry);
  if (!sampledIn) return;
  dispatchSafely(state.transport, entry);
  if (globalTransports.length > 0) {
    for (const transport of globalTransports) dispatchSafely(transport, entry);
  }
};
