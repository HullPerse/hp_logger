import type { LazyContext, LazyMessage, LogLevel, LoggerState } from "../types/logger";
import type { Transport } from "../types/transport";
import { buildEntry } from "./entry.core";

const globalTransports: Transport[] = [];

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

/** Route one entry through the pipeline: build, filter, dispatch. */
export const writeEntry = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  context: LazyContext | undefined,
): void => {
  if (!state.enabled) return;
  const entry = buildEntry(state, level, message, context);
  if (entry === null) return;
  state.transport.write(entry);
  if (globalTransports.length > 0) {
    for (const transport of globalTransports) transport.write(entry);
  }
};
