import path from "node:path";

import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_MAX_OPERATIONS } from "../config/metrics.config";
import { DEFAULT_REDACT_KEYS } from "../config/redaction.config";
import type { LoggerSettings, LogLevel, ResolvedSettings } from "../types/logger";

const isTraversalBlocked = (candidate: string): boolean => candidate.split(/[\\/]/u).includes("..");

const warnOutsideCwd = (kind: string, candidate: string): void => {
  if (path.isAbsolute(candidate)) {
    const resolved = path.resolve(candidate);
    const cwd = process.cwd();
    if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`)) {
      console.warn(`hp_logger: ${kind} path outside cwd: ${candidate}`);
    }
  }
};

const sanitizeFile = <T extends { path?: string } | false | undefined>(file: T): T | false => {
  if (file === undefined || file === false) return file as T | false;
  if (typeof file === "object" && file !== null && "path" in file) {
    const candidate = (file as { path?: string }).path;
    if (candidate !== undefined) {
      if (isTraversalBlocked(candidate)) {
        console.warn(`hp_logger: file path blocked: ${candidate} (traversal)`);
        return false;
      }
      warnOutsideCwd("file", candidate);
    }
  }
  return file as T | false;
};



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

/**
 * One settings feature: how its slice of `LoggerSettings` resolves to the
 * runtime shape, and how a patch folds over an already resolved base. Blocks
 * keep both directions next to each other so a new field cannot update one
 * and forget the other; `resolveSettings` and `mergeSettings` stay explicit
 * so TypeScript still forces every `ResolvedSettings` key to appear.
 */
interface SettingsBlock<K extends keyof ResolvedSettings> {
  merge: (base: ResolvedSettings[K], patch: LoggerSettings) => ResolvedSettings[K];
  resolve: (settings: LoggerSettings) => ResolvedSettings[K];
}

type TagSettings = Pick<
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

/** Single source for every pretty-tag default; resolve and merge read it. */
const TAG_DEFAULTS: TagSettings = {
  colorizeContext: false,
  emoji: false,
  showAuthor: true,
  showDate: false,
  showElapsed: false,
  showLevel: false,
  showTime: true,
  showYear: false,
  stripControl: false,
  tagCase: "upper",
};

const TAG_KEYS = Object.keys(TAG_DEFAULTS) as (keyof TagSettings)[];

const pickTags = (source: Record<keyof TagSettings, unknown>): TagSettings => {
  // Keyed writes need the record view: TypeScript cannot correlate a union
  // key with its value type in a direct assignment.
  const out = {} as Record<keyof TagSettings, unknown>;
  for (const key of TAG_KEYS) out[key] = source[key];
  return out as TagSettings;
};

/** Pretty-console tag switches: ten flat fields driven by one defaults table. */
const tagBlock = {
  merge(base: TagSettings, patch: LoggerSettings): TagSettings {
    const source = {} as Record<keyof TagSettings, unknown>;
    for (const key of TAG_KEYS) source[key] = patch[key] ?? base[key];
    return pickTags(source);
  },
  resolve(settings: LoggerSettings): TagSettings {
    const source = {} as Record<keyof TagSettings, unknown>;
    for (const key of TAG_KEYS) source[key] = settings[key] ?? TAG_DEFAULTS[key];
    return pickTags(source);
  },
};

const TASK_DEFAULTS: NonNullable<ResolvedSettings["task"]> = { level: "debug", progress: false };

/** Pending-task entries via logger.task(). */
const taskBlock: SettingsBlock<"task"> = {
  merge(base, patch) {
    return {
      level: patch.task?.level ?? base.level,
      progress: patch.task?.progress ?? base.progress,
    };
  },
  resolve(settings) {
    return {
      level: settings.task?.level ?? TASK_DEFAULTS.level,
      progress: settings.task?.progress ?? TASK_DEFAULTS.progress,
    };
  },
};

const DEFAULT_BLACKBOX_SIZE = 1000;

const buildBlackbox = (box: Exclude<LoggerSettings["blackbox"], undefined | false>) => {
  let candidatePath = box.path;
  if (candidatePath !== undefined) {
    if (isTraversalBlocked(candidatePath)) {
      console.warn(`hp_logger: blackbox path blocked: ${candidatePath} (traversal)`);
      candidatePath = undefined;
    } else {
      warnOutsideCwd("blackbox", candidatePath);
    }
  }
  return {
    path: candidatePath,
    size: Math.max(1, box.size ?? DEFAULT_BLACKBOX_SIZE),
  };
};
const blackboxBlock: SettingsBlock<"blackbox"> = {
  merge(base, patch) {
    const { blackbox } = patch;
    if (blackbox === false) return false;
    if (blackbox === undefined) return base;
    return buildBlackbox(blackbox);
  },
  resolve(settings) {
    const { blackbox } = settings;
    return blackbox ? buildBlackbox(blackbox) : false;
  },
};

const BOX_DEFAULTS: NonNullable<ResolvedSettings["box"]> = {
  error: false,
  fatal: false,
  storm: false,
};

/** ASCII frames around dense pretty-console blocks. */
const boxBlock: SettingsBlock<"box"> = {
  merge(base, patch) {
    const { box } = patch;
    if (box === false) return false;
    if (box === undefined) return base;
    const source = base === false ? BOX_DEFAULTS : base;
    return {
      error: box.error ?? source.error,
      fatal: box.fatal ?? source.fatal,
      storm: box.storm ?? source.storm,
    };
  },
  resolve(settings) {
    const { box } = settings;
    if (!box) return false;
    return {
      error: box.error ?? BOX_DEFAULTS.error,
      fatal: box.fatal ?? BOX_DEFAULTS.fatal,
      storm: box.storm ?? BOX_DEFAULTS.storm,
    };
  },
};

const buildProfile = (profile: Exclude<LoggerSettings["profile"], undefined | false>) => {
  const maxOperations =
    profile === true ? DEFAULT_MAX_OPERATIONS : (profile.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  return { maxOperations: Math.max(1, maxOperations) };
};

/** Aggregation of time()/span()/task() durations into operation histograms. */
const profileBlock: SettingsBlock<"profile"> = {
  merge(base, patch) {
    const { profile } = patch;
    if (profile === undefined) return base;
    if (!profile) return false;
    return buildProfile(profile);
  },
  resolve(settings) {
    const { profile } = settings;
    if (!profile) return false;
    return buildProfile(profile);
  },
};

/** Trace-coherent sampling; error/fatal always pass (enforced in the pipeline). */
const samplingBlock: SettingsBlock<"sampling"> = {
  merge(base, patch) {
    const incoming = patch.sampling;
    if (incoming === undefined) return base;
    if (incoming === false) return false;
    return { perTrace: incoming.perTrace ?? true, rate: incoming.rate };
  },
  resolve(settings) {
    const { sampling } = settings;
    return sampling ? { perTrace: sampling.perTrace ?? true, rate: sampling.rate } : false;
  },
};

/** Redaction knobs; `redactKeys: null` explicitly disables the denylist. */
interface RedactionSlice {
  redactDepth: number;
  redactKeys: RegExp | null;
  redactPaths: string[];
  redactCensor: string;
  redactPii: { card: boolean; email: boolean } | false;
}
const redactionBlock = {
  merge(base: ResolvedSettings, patch: LoggerSettings): RedactionSlice {
    return {
      redactDepth: patch.redactDepth ?? base.redactDepth,
      redactKeys: patch.redactKeys === undefined ? base.redactKeys : patch.redactKeys,
      redactPaths: patch.redactPaths ?? base.redactPaths,
      redactCensor: patch.redactCensor ?? base.redactCensor,
      redactPii:
        patch.redactPii === undefined
          ? base.redactPii
          : resolveRedactPii(patch.redactPii),
    };
  },
  resolve(settings: LoggerSettings): RedactionSlice {
    return {
      redactDepth: settings.redactDepth ?? 2,
      redactKeys: settings.redactKeys === undefined ? DEFAULT_REDACT_KEYS : settings.redactKeys,
      redactPaths: settings.redactPaths ?? [],
      redactCensor: settings.redactCensor ?? "[REDACTED]",
      redactPii: resolveRedactPii(settings.redactPii ?? false),
    };
  },
};

const resolveRedactPii = (value: LoggerSettings["redactPii"]) =>
  value && (value.card === true || value.email === true)
    ? { card: value.card === true, email: value.email === true }
    : false;

/** Static top-level metadata fields stamped onto every entry. */
const baseFieldsBlock = {
  merge(base: ResolvedSettings, patch: LoggerSettings) {
    return patch.baseFields === undefined ? base.baseFields : normalizeBaseFields(patch.baseFields);
  },
  resolve(settings: LoggerSettings) {
    return normalizeBaseFields(settings.baseFields ?? false);
  },
};

const normalizeBaseFields = (
  value: LoggerSettings["baseFields"],
): Record<string, unknown> | false =>
  value && typeof value === "object" && Object.keys(value).length > 0 ? { ...value } : false;

/** Output shaping: mode, format callbacks, limits. */
const formatBlock = {
  merge(base: ResolvedSettings, patch: LoggerSettings) {
    return {
      format: patch.format ?? base.format,
      formatContext: patch.formatContext ?? base.formatContext,
      formatTimestamp: patch.formatTimestamp ?? base.formatTimestamp,
      level: patch.level ?? base.level,
      maxMessageLength: patch.maxMessageLength ?? base.maxMessageLength,
      mixin: patch.mixin ?? base.mixin,
      mode: patch.mode ?? base.mode,
      prettyTruncate: patch.prettyTruncate ?? base.prettyTruncate,
      prettyWrap: patch.prettyWrap ?? base.prettyWrap,
    };
  },
  resolve(settings: LoggerSettings) {
    return {
      format: settings.format,
      formatContext: settings.formatContext ?? "json",
      formatTimestamp: settings.formatTimestamp ?? "iso",
      level: settings.level ?? "info",
      maxMessageLength: settings.maxMessageLength ?? 2000,
      mixin: settings.mixin,
      mode: settings.mode ?? defaultMode(),
      prettyTruncate: settings.prettyTruncate ?? false,
      prettyWrap: settings.prettyWrap ?? false,
    };
  },
};

export const resolveSettings = (settings: LoggerSettings = {}): ResolvedSettings => {
  const fmt = formatBlock.resolve(settings);
  const redaction = redactionBlock.resolve(settings);
  const tags = tagBlock.resolve(settings);
  return {
    adaptive: settings.adaptive ?? false,
    autoCounters: settings.autoCounters ?? false,
    baseFields: normalizeBaseFields(settings.baseFields ?? false),
    batching: settings.batching ?? false,
    blackbox: blackboxBlock.resolve(settings),
    box: boxBlock.resolve(settings),
    bufferedConsole: settings.bufferedConsole ?? false,
    callSite: settings.callSite ?? false,
    colorizeContext: tags.colorizeContext,
    colors: settings.colors ?? {},
    database: settings.database ?? false,
    emoji: tags.emoji,
    enabled: settings.enabled ?? true,
    file: sanitizeFile(settings.file) ?? false,
    filters: settings.filters ?? [],
    format: fmt.format,
    formatContext: fmt.formatContext,
    formatTimestamp: fmt.formatTimestamp,
    level: fmt.level,
    maxMessageLength: fmt.maxMessageLength,
    mixin: fmt.mixin,
    mode: fmt.mode,
    prettyTruncate: fmt.prettyTruncate,
    prettyWrap: fmt.prettyWrap,
    profile: profileBlock.resolve(settings),
    redactDepth: redaction.redactDepth,
    redactKeys: redaction.redactKeys,
    redactPaths: redaction.redactPaths,
    redactCensor: redaction.redactCensor,
    redactPii: redaction.redactPii,
    repeat: settings.repeat ?? false,
    resolvers: settings.resolvers ?? false,
    sampling: samplingBlock.resolve(settings),
    schemaVersion: settings.schemaVersion ?? false,
    serializers: settings.serializers,
    showAuthor: tags.showAuthor,
    showDate: tags.showDate,
    showElapsed: tags.showElapsed,
    showLevel: tags.showLevel,
    showTime: tags.showTime,
    showYear: tags.showYear,
    stripControl: tags.stripControl,
    tagCase: tags.tagCase,
    task: taskBlock.resolve(settings),
  };
};

export const mergeSettings = (base: ResolvedSettings, patch: LoggerSettings): ResolvedSettings => {
  const fmt = formatBlock.merge(base, patch);
  const redaction = redactionBlock.merge(base, patch);
  const tags = tagBlock.merge(base, patch);
  return {
    adaptive: patch.adaptive ?? base.adaptive,
    autoCounters: patch.autoCounters ?? base.autoCounters,
    baseFields: baseFieldsBlock.merge(base, patch),
    batching: patch.batching ?? base.batching,
    blackbox: blackboxBlock.merge(base.blackbox, patch),
    box: boxBlock.merge(base.box, patch),
    bufferedConsole: patch.bufferedConsole ?? base.bufferedConsole,
    callSite: patch.callSite ?? base.callSite,
    colorizeContext: tags.colorizeContext,
    colors: patch.colors ?? base.colors,
    database: patch.database ?? base.database,
    emoji: tags.emoji,
    enabled: patch.enabled ?? base.enabled,
    file: sanitizeFile(patch.file) ?? base.file,
    filters: patch.filters ?? base.filters,
    format: fmt.format,
    formatContext: fmt.formatContext,
    formatTimestamp: fmt.formatTimestamp,
    level: fmt.level,
    maxMessageLength: fmt.maxMessageLength,
    mixin: fmt.mixin,
    mode: fmt.mode,
    prettyTruncate: fmt.prettyTruncate,
    prettyWrap: fmt.prettyWrap,
    profile: profileBlock.merge(base.profile, patch),
    redactDepth: redaction.redactDepth,
    redactKeys: redaction.redactKeys,
    redactPaths: redaction.redactPaths,
    redactCensor: redaction.redactCensor,
    redactPii: redaction.redactPii,
    repeat: patch.repeat ?? base.repeat,
    resolvers: patch.resolvers ?? base.resolvers,
    sampling: samplingBlock.merge(base.sampling, patch),
    schemaVersion: patch.schemaVersion ?? base.schemaVersion,
    serializers: patch.serializers ?? base.serializers,
    showAuthor: tags.showAuthor,
    showDate: tags.showDate,
    showElapsed: tags.showElapsed,
    showLevel: tags.showLevel,
    showTime: tags.showTime,
    showYear: tags.showYear,
    stripControl: tags.stripControl,
    tagCase: tags.tagCase,
    task: taskBlock.merge(base.task, patch),
  };
};
