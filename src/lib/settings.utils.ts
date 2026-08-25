import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_MAX_OPERATIONS } from "../config/metrics.config";
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

/**
 * Per-module levels from `LOG_MODULES="auth:debug,http:warn"` (the
 * debug/RUST_LOG pattern). Unknown levels in a pair are skipped; a bare
 * `*` entry sets the default for modules without their own pair. A trailing
 * `*` in the module part declares a prefix wildcard (`web*` matches
 * `web`, `web/api`); exact names win over wildcards, longer prefixes win
 * over shorter ones.
 */
export const resolveEnvModules = (
  env: Record<string, string | undefined> = process.env,
): Map<string, LogLevel> => {
  const map = new Map<string, LogLevel>();
  const raw = env.LOG_MODULES;
  if (raw === undefined || raw === "") return map;
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep === -1) continue;
    const name = pair.slice(0, sep).trim();
    const level = pair.slice(sep + 1).trim();
    if (name === "" || !(level in LOG_LEVELS)) continue;
    map.set(name, level as LogLevel);
  }
  return map;
};

/**
 * Resolve the env level for one module name: the exact pair wins, then the
 * longest matching prefix wildcard, then the bare `*` default.
 */
export const matchEnvModule = (
  modules: Map<string, LogLevel> | undefined,
  name: string,
): LogLevel | undefined => {
  if (modules === undefined) return undefined;
  const exact = modules.get(name);
  if (exact !== undefined) return exact;
  let best: { length: number; level: LogLevel } | undefined;
  for (const [pattern, level] of modules) {
    if (pattern === "*" || !pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (!name.startsWith(prefix)) continue;
    if (best === undefined || prefix.length > best.length) best = { length: prefix.length, level };
  }
  return best?.level ?? modules.get("*");
};

type ResolvedTagSettings = Pick<
  ResolvedSettings,
  | "colorizeContext"
  | "emoji"
  | "showAuthor"
  | "showDate"
  | "showElapsed"
  | "showLevel"
  | "showTime"
  | "showYear"
  | "stripControl"
  | "tagCase"
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

const DEFAULT_BOX: NonNullable<ResolvedSettings["box"]> = {
  error: false,
  fatal: false,
  storm: false,
};

const resolveBoxSettings = (settings: LoggerSettings): ResolvedSettings["box"] => {
  const { box } = settings;
  if (!box) return false;
  return {
    error: box.error ?? false,
    fatal: box.fatal ?? false,
    storm: box.storm ?? false,
  };
};

const mergeBoxSettings = (
  base: ResolvedSettings["box"],
  patch: LoggerSettings,
): ResolvedSettings["box"] => {
  const { box } = patch;
  if (box === false) return false;
  if (box === undefined) return base;
  const source = base === false ? DEFAULT_BOX : base;
  return {
    error: box.error ?? source.error,
    fatal: box.fatal ?? source.fatal,
    storm: box.storm ?? source.storm,
  };
};

const resolveProfile = (settings: LoggerSettings): ResolvedSettings["profile"] => {
  const { profile } = settings;
  if (!profile) return false;
  const maxOperations =
    profile === true ? DEFAULT_MAX_OPERATIONS : (profile.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  return { maxOperations: Math.max(1, maxOperations) };
};

const mergeProfile = (
  base: ResolvedSettings["profile"],
  patch: LoggerSettings,
): ResolvedSettings["profile"] => {
  const { profile } = patch;
  if (!profile) return profile === undefined ? base : false;
  return resolveProfile({ profile });
};

const resolveRedactionSettings = (settings: LoggerSettings) => ({
  redactDepth: settings.redactDepth ?? 2,
  redactKeys: settings.redactKeys === undefined ? DEFAULT_REDACT_KEYS : settings.redactKeys,
  redactPaths: settings.redactPaths ?? [],
});

const resolveSamplingSettings = (settings: LoggerSettings): ResolvedSettings["sampling"] =>
  settings.sampling
    ? { perTrace: settings.sampling.perTrace ?? true, rate: settings.sampling.rate }
    : false;

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
  box: resolveBoxSettings(settings),
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
  mixin: settings.mixin,
  mode: settings.mode ?? defaultMode(),
  prettyTruncate: settings.prettyTruncate ?? false,
  prettyWrap: settings.prettyWrap ?? false,
  profile: resolveProfile(settings),
  ...resolveRedactionSettings(settings),
  repeat: settings.repeat ?? false,
  sampling: resolveSamplingSettings(settings),
  schemaVersion: settings.schemaVersion ?? false,
  serializers: settings.serializers,
  task: resolveTaskSettings(settings),
  ...resolveTagSettings(settings),
});

const mergeFormatSettings = (base: ResolvedSettings, patch: LoggerSettings) => ({
  format: patch.format ?? base.format,
  formatContext: patch.formatContext ?? base.formatContext,
  formatTimestamp: patch.formatTimestamp ?? base.formatTimestamp,
  level: patch.level ?? base.level,
  maxMessageLength: patch.maxMessageLength ?? base.maxMessageLength,
  mixin: patch.mixin ?? base.mixin,
  mode: patch.mode ?? base.mode,
  prettyTruncate: patch.prettyTruncate ?? base.prettyTruncate,
  prettyWrap: patch.prettyWrap ?? base.prettyWrap,
});

const mergeSamplingSettings = (
  base: ResolvedSettings["sampling"],
  patch: LoggerSettings,
): ResolvedSettings["sampling"] => {
  const incoming = patch.sampling;
  if (incoming === undefined) return base;
  if (incoming === false) return false;
  return { perTrace: incoming.perTrace ?? true, rate: incoming.rate };
};

const mergeRedactionSettings = (base: ResolvedSettings, patch: LoggerSettings) => ({
  redactDepth: patch.redactDepth ?? base.redactDepth,
  redactKeys: patch.redactKeys === undefined ? base.redactKeys : patch.redactKeys,
  redactPaths: patch.redactPaths ?? base.redactPaths,
});

export const mergeSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedSettings => ({
  adaptive: patch.adaptive ?? base.adaptive,
  autoCounters: patch.autoCounters ?? base.autoCounters,
  batching: patch.batching ?? base.batching,
  blackbox: mergeBlackbox(base.blackbox, patch),
  box: mergeBoxSettings(base.box, patch),
  colors: patch.colors ?? base.colors,
  database: patch.database ?? base.database,
  enabled: patch.enabled ?? base.enabled,
  file: patch.file ?? base.file,
  filters: patch.filters ?? base.filters,
  ...mergeFormatSettings(base, patch),
  ...mergeRedactionSettings(base, patch),
  profile: mergeProfile(base.profile, patch),
  repeat: patch.repeat ?? base.repeat,
  sampling: mergeSamplingSettings(base.sampling, patch),
  schemaVersion: patch.schemaVersion ?? base.schemaVersion,
  serializers: patch.serializers ?? base.serializers,
  task: mergeTaskSettings(base.task, patch),
  ...mergeTagSettings(base, patch),
});
