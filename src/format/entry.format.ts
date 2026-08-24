import type { ContextFormat, EntryFormatter, LogEntry, TagCase } from "../types/logger";
import { formatContext } from "./context.format";
import { caseTag } from "./tag.format";

export const formatEntry = (
  entry: LogEntry,
  mode: "json" | "pretty",
  contextFormat: ContextFormat = "json",
  formatter?: EntryFormatter,
  tagCase: TagCase = "upper",
): string => {
  if (mode === "json") return JSON.stringify(entry);
  if (formatter) return formatter(entry);
  return `[${entry.timestamp}] [${caseTag(entry.author, tagCase)}] [${caseTag(entry.level, tagCase)}] ${entry.message}${formatContext(entry.context, contextFormat)}`;
};
