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

/** Braille frames cycled by consecutive task progress entries ({task.frame}). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Glyph per task status, used by the {task.glyph} template token. */
export const TASK_GLYPHS: Record<string, string> = {
  done: "✔",
  failed: "✘",
  started: "▶",
};
