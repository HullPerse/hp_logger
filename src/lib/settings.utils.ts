import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_REDACT_KEYS } from "../config/redaction.config";
import type { LoggerSettings, LogLevel, ResolvedSettings } from "../types/logger";

/** Adaptive mode: TTY gets tagged pretty output, pipes/files get JSON. */
export const resolveDefaultMode = (isTTY: boolean | undefined): "pretty" | "json" =>
  isTTY ? "pretty" : "json";

const defaultMode = (): "pretty" | "json" =>
  typeof process === "undefined" ? "json" : resolveDefaultMode(process.stdout.isTTY);

export const resolveEnvLevel = (
  env: Record<string, string | undefined> = process.env,
): LogLevel => {
  const configured = env.LOG_LEVEL;
  return configured && configured in LOG_LEVELS ? (configured as LogLevel) : "info";
};

type ResolvedTagSettings = Pick<
  ResolvedSettings,
  "showAuthor" | "showDate" | "showLevel" | "showTime" | "showYear" | "tagCase"
>;

const resolveTagSettings = (settings: LoggerSettings): ResolvedTagSettings => ({
  showAuthor: settings.showAuthor ?? true,
  showDate: settings.showDate ?? false,
  showLevel: settings.showLevel ?? false,
  showTime: settings.showTime ?? true,
  showYear: settings.showYear ?? false,
  tagCase: settings.tagCase ?? "upper",
});

const mergeTagSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedTagSettings => ({
  showAuthor: patch.showAuthor ?? base.showAuthor,
  showDate: patch.showDate ?? base.showDate,
  showLevel: patch.showLevel ?? base.showLevel,
  showTime: patch.showTime ?? base.showTime,
  showYear: patch.showYear ?? base.showYear,
  tagCase: patch.tagCase ?? base.tagCase,
});

export const resolveSettings = (settings: LoggerSettings = {}): ResolvedSettings => ({
  batching: settings.batching ?? false,
  colors: settings.colors ?? {},
  database: settings.database ?? false,
  enabled: settings.enabled ?? true,
  file: settings.file ?? false,
  filters: settings.filters ?? [],
  format: settings.format,
  formatContext: settings.formatContext ?? "json",
  formatTimestamp: settings.formatTimestamp ?? "iso",
  level: settings.level ?? "info",
  maxMessageLength: settings.maxMessageLength ?? 2000,
  mode: settings.mode ?? defaultMode(),
  prettyTruncate: settings.prettyTruncate ?? false,
  prettyWrap: settings.prettyWrap ?? false,
  redactDepth: settings.redactDepth ?? 2,
  redactKeys: settings.redactKeys === undefined ? DEFAULT_REDACT_KEYS : settings.redactKeys,
  ...resolveTagSettings(settings),
});

export const mergeSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedSettings => ({
  batching: patch.batching ?? base.batching,
  colors: patch.colors ?? base.colors,
  database: patch.database ?? base.database,
  enabled: patch.enabled ?? base.enabled,
  file: patch.file ?? base.file,
  filters: patch.filters ?? base.filters,
  format: patch.format ?? base.format,
  formatContext: patch.formatContext ?? base.formatContext,
  formatTimestamp: patch.formatTimestamp ?? base.formatTimestamp,
  level: patch.level ?? base.level,
  maxMessageLength: patch.maxMessageLength ?? base.maxMessageLength,
  mode: patch.mode ?? base.mode,
  prettyTruncate: patch.prettyTruncate ?? base.prettyTruncate,
  prettyWrap: patch.prettyWrap ?? base.prettyWrap,
  redactDepth: patch.redactDepth ?? base.redactDepth,
  redactKeys: patch.redactKeys === undefined ? base.redactKeys : patch.redactKeys,
  ...mergeTagSettings(base, patch),
});
