import type { ColorName, LogLevel } from "../types/logger";

export const DEFAULT_LEVEL_COLORS: Record<string, ColorName> = {
  debug: "magenta",
  error: "red",
  fatal: "red",
  info: "blue",
  success: "green",
  trace: "gray",
  warn: "yellow",
};

/** Emoji per level, used in pretty console output when `emoji` is enabled. */
export const LEVEL_EMOJIS: Record<LogLevel, string> = {
  debug: "🐛",
  error: "❌",
  fatal: "💀",
  info: "ℹ️",
  success: "✅",
  trace: "🔍",
  warn: "⚠️",
};
