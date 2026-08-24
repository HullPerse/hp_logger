import type { ColorName } from "../types/logger";

export const DEFAULT_LEVEL_COLORS: Record<string, ColorName> = {
  debug: "magenta",
  error: "red",
  fatal: "red",
  info: "blue",
  success: "green",
  trace: "gray",
  warn: "yellow",
};
