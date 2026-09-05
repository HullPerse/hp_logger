import type { LogLevel } from "../types/logger.js";

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 1,
  error: 5,
  fatal: 6,
  info: 2,
  success: 3,
  trace: 0,
  warn: 4,
} as const;

/** Level names in ascending order, used to precompute per-level tags. */
export const LEVEL_NAMES: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "success",
  "warn",
  "error",
  "fatal",
];
