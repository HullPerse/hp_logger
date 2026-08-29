import type { LogEntry } from "../types/logger";
import type { Transport } from "../types/transport";

/** Summary entry for an aggregated group: the first entry plus an xN marker. */
export const countSummary = (entry: LogEntry, count: number): LogEntry => ({
  ...entry,
  context: { ...entry.context, count },
  message: `${entry.message} ×${count}`,
});

/** Send a batch through a transport: `writeBatch` when present, else one `write` per entry. */
export const dispatchBatch = async (transport: Transport, entries: LogEntry[]): Promise<void> => {
  if (transport.writeBatch) {
    await transport.writeBatch(entries);
    return;
  }
  for (const entry of entries) {
    const result = transport.write(entry);
    if (result instanceof Promise) await result;
  }
};

/** setInterval that does not keep the process alive; the handle must be stopped on close. */
export const startUnrefInterval = (
  fn: () => void,
  interval: number,
): ReturnType<typeof setInterval> => {
  const handle = setInterval(fn, interval);
  handle.unref();
  return handle;
};

export const stopInterval = (handle: ReturnType<typeof setInterval> | null): void => {
  if (handle) clearInterval(handle);
};

/** setTimeout that does not keep the process alive; the handle must be stopped on close. */
export const startUnrefTimeout = (
  fn: () => void,
  timeoutMs: number,
): ReturnType<typeof setTimeout> => {
  const handle = setTimeout(fn, Math.max(0, timeoutMs));
  handle.unref();
  return handle;
};

export const stopTimeout = (handle: ReturnType<typeof setTimeout> | null): void => {
  if (handle) clearTimeout(handle);
};
