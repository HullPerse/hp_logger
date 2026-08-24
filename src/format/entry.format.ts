import { safeStringify, stripControlCharacters } from "../lib/json.utils";
import type { ContextFormat, EntryFormatter, LogEntry, TagCase } from "../types/logger";
import { formatContext } from "./context.format";
import { caseTag } from "./tag.format";

export const formatEntry = (
  entry: LogEntry,
  mode: "json" | "pretty",
  contextFormat: ContextFormat = "json",
  formatter?: EntryFormatter,
  tagCase: TagCase = "upper",
  stripControl = false,
): string => {
  if (mode === "json") return safeStringify(entry);
  if (formatter) {
    return stripControl ? stripControlCharacters(formatter(entry)) : formatter(entry);
  }
  const line = `[${entry.timestamp}] [${caseTag(entry.author, tagCase)}] [${caseTag(entry.level, tagCase)}] ${entry.message}${formatContext(entry.context, contextFormat)}`;
  return stripControl ? stripControlCharacters(line) : line;
};
