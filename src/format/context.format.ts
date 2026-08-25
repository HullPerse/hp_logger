import { EMPTY_CONTEXT } from "../config/context.config";
import { safeStringify } from "../lib/json.utils";
import type { ContextFormat, LogContext } from "../types/logger";

export const formatContext = (context: LogContext, contextFormat: ContextFormat): string => {
  if (context === EMPTY_CONTEXT || Object.keys(context).length === 0) return "";
  if (contextFormat === "json") return ` ${safeStringify(context)}`;
  const pairs = Object.entries(context).map(([key, entryValue]) => {
    const rendered = typeof entryValue === "string" ? `"${entryValue}"` : safeStringify(entryValue);
    return `${key}=${rendered}`;
  });
  return ` ${pairs.join(" ")}`;
};
