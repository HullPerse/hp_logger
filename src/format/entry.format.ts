import { safeStringify, stripControlCharacters } from "../lib/json.utils";
import type { ContextFormat, EntryFormatter, FormatSettings, LogEntry, TagCase } from "../types/logger";
import { formatContext } from "./context.format";
import { renderTemplateSettings } from "./template.format";
import { caseTag } from "./tag.format";

export const formatEntry = (
  entry: LogEntry,
  mode: "json" | "pretty",
  contextFormat: ContextFormat = "json",
  formatter?: EntryFormatter | FormatSettings,
  tagCase: TagCase = "upper",
  stripControl = false,
): string => {
  if (mode === "json") return safeStringify(entry);
  if (formatter !== undefined) {
    if (typeof formatter === "function") {
      return stripControl ? stripControlCharacters(formatter(entry)) : formatter(entry);
    }
    // Templates render plain in files: file pretty output carries no colors.
    const line = renderTemplateSettings(formatter, entry, {
      authorName: (author) => caseTag(author, tagCase),
      colorize: false,
      contextFormat,
      elapsedMs: null,
      levelColor: () => false,
      stripControl,
      tagCase,
    });
    return line;
  }
  const line = `[${entry.timestamp}] [${caseTag(entry.author, tagCase)}] [${caseTag(entry.level, tagCase)}] ${entry.message}${formatContext(entry.context, contextFormat)}`;
  return stripControl ? stripControlCharacters(line) : line;
};
