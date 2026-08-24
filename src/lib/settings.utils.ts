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
  "colorizeContext" | "emoji" | "showAuthor" | "showDate" | "showElapsed" | "showLevel" | "showTime" | "showYear" | "stripControl" | "tagCase"
>;

const resolveTagSettings = (settings: LoggerSettings): ResolvedTagSettings => ({
  colorizeContext: settings.colorizeContext ?? false,
  emoji: settings.emoji ?? false,
  showAuthor: settings.showAuthor ?? true,
  showDate: settings.showDate ?? false,
  showElapsed: settings.showElapsed ?? false,
  showLevel: settings.showLevel ?? false,
  showTime: settings.showTime ?? true,
  showYear: settings.showYear ?? false,
  stripControl: settings.stripControl ?? false,
  tagCase: settings.tagCase ?? "upper",
});

const DEFAULT_TASK_SETTINGS = { level: "debug" as LogLevel, progress: false };

const resolveTaskSettings = (settings: LoggerSettings): ResolvedSettings["task"] => ({
  level: settings.task?.level ?? DEFAULT_TASK_SETTINGS.level,
  progress: settings.task?.progress ?? DEFAULT_TASK_SETTINGS.progress,
});

const mergeTaskSettings = (
  base: ResolvedSettings["task"],
  patch: LoggerSettings,
): ResolvedSettings["task"] => ({
  level: patch.task?.level ?? base.level,
  progress: patch.task?.progress ?? base.progress,
});

const DEFAULT_BLACKBOX_SIZE = 1000;

const resolveBlackbox = (settings: LoggerSettings): ResolvedSettings["blackbox"] => {
  const box = settings.blackbox;
  return box ? { path: box.path, size: Math.max(1, box.size ?? DEFAULT_BLACKBOX_SIZE) } : false;
};

const mergeBlackbox = (
  base: ResolvedSettings["blackbox"],
  patch: LoggerSettings,
): ResolvedSettings["blackbox"] => {
  const box = patch.blackbox;
  if (box === false) return false;
  if (box === undefined) return base;
  return { path: box.path, size: Math.max(1, box.size ?? DEFAULT_BLACKBOX_SIZE) };
};

const mergeTagSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedTagSettings => ({
  colorizeContext: patch.colorizeContext ?? base.colorizeContext,
  emoji: patch.emoji ?? base.emoji,
  showAuthor: patch.showAuthor ?? base.showAuthor,
  showDate: patch.showDate ?? base.showDate,
  showElapsed: patch.showElapsed ?? base.showElapsed,
  showLevel: patch.showLevel ?? base.showLevel,
  showTime: patch.showTime ?? base.showTime,
  showYear: patch.showYear ?? base.showYear,
  stripControl: patch.stripControl ?? base.stripControl,
  tagCase: patch.tagCase ?? base.tagCase,
});

export const resolveSettings = (settings: LoggerSettings = {}): ResolvedSettings => ({
  adaptive: settings.adaptive ?? false,
  autoCounters: settings.autoCounters ?? false,
  batching: settings.batching ?? false,
  blackbox: resolveBlackbox(settings),
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
  repeat: settings.repeat ?? false,
  task: resolveTaskSettings(settings),
  ...resolveTagSettings(settings),
});

export const mergeSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedSettings => ({
  adaptive: patch.adaptive ?? base.adaptive,
  autoCounters: patch.autoCounters ?? base.autoCounters,
  batching: patch.batching ?? base.batching,
  blackbox: mergeBlackbox(base.blackbox, patch),
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
  repeat: patch.repeat ?? base.repeat,
  task: mergeTaskSettings(base.task, patch),
  ...mergeTagSettings(base, patch),
});
