import type { LogEntry } from "../types/logger.js";

/** True when any filter rejects the entry. */
export const isFiltered = (filters: ((entry: LogEntry) => boolean)[], entry: LogEntry): boolean =>
  filters.some((filter) => !filter(entry));
