import { LruCache } from "../brain/lru.utils.js";
import { registerBrainCache } from "../brain/registry.utils.js";
import { SPINNER_FRAMES, TASK_GLYPHS } from "../config/colors.config.js";
import { applyColor } from "../lib/color.utils.js";
import { safeStringify, stripControlCharacters } from "../lib/json.utils.js";
import type { ColorName, ContextFormat, LogEntry, LogLevel, TagCase } from "../types/logger.js";
import { formatContext } from "./context.format.js";
import { formatDuration } from "./duration.format.js";
import { caseTag } from "./tag.format.js";

/** A `{name}` or `{:color}text{:/}` piece of a parsed template. */
export interface TemplatePart {
  /** Explicit color from `{token:color}` or `{:color}...{:/}`. */
  color?: ColorName;
  kind: "literal" | "token";
  /** True for tokens that inherit the level color when no color is set. */
  levelColored?: boolean;
  value: string;
}

export interface TemplateEnv {
  authorName: (author: string) => string;
  colorize: boolean;
  contextFormat: ContextFormat;
  /** Elapsed-ms source; `null` where uptime is unknown (files render it empty). */
  elapsedMs: (() => number) | null;
  levelColor: (level: LogLevel) => ColorName | false | undefined;
  stripControl: boolean;
  tagCase: TagCase;
}

const KNOWN_TOKENS = new Set([
  "author",
  "context",
  "context.kv",
  "elapsed",
  "group.indent",
  "level",
  "level.tag",
  "message",
  "retry.attempt",
  "task",
  "task.frame",
  "task.glyph",
  "timestamp",
  "timestamp.date",
  "timestamp.day",
  "timestamp.hour",
  "timestamp.minute",
  "timestamp.month",
  "timestamp.ms",
  "timestamp.second",
  "timestamp.time",
  "timestamp.weekday",
  "timestamp.year",
]);

// Warn-once bookkeeping for unknown tokens, capped so hostile or generated
// templates cannot grow module state without bound (mirrors the redact memo
// cap). After eviction a token may warn again; memory stays bounded.
const warnedTokens = new LruCache<string, true>(2048);
registerBrainCache("template.warnedTokens", () => warnedTokens.stats());

/**
 * User-registered token renderers. Names must be dotless (dotted namespaces
 * belong to built-ins) and cannot shadow reserved tokens; registration wins
 * over context keys of the same name, and re-registering updates the
 * renderer.
 */
const customTokens = new Map<string, (entry: LogEntry) => string>();

/** Formatters for every `{timestamp.*}` subfield, keyed by suffix ("" = full ISO). */
const ISO_FORMATTERS: Record<string, ((iso: string) => string) | undefined> = {
  "": (iso) => iso,
  date: (iso) => iso.slice(5, 10),
  day: (iso) => iso.slice(8, 10),
  hour: (iso) => iso.slice(11, 13),
  minute: (iso) => iso.slice(14, 16),
  month: (iso) => iso.slice(5, 7),
  ms: (iso) => iso.slice(20, 23),
  second: (iso) => iso.slice(17, 19),
  time: (iso) => iso.slice(11, 19),
  weekday: (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toUTCString().slice(0, 3);
  },
  year: (iso) => iso.slice(0, 4),
};

/**
 * Parse a template into literals and tokens. Syntax:
 * `{token}` - resolved field; `{token:color}` - explicit color;
 * `{:color}text{:/}` - colored literal span (no nesting); `\{` - literal brace.
 * Unknown token names are kept as literal text and warned about once.
 */
export const parseTemplate = (source: string): TemplatePart[] => {
  const parts: TemplatePart[] = [];
  let literal = "";
  let spanColor: ColorName | undefined;

  const flushLiteral = (): void => {
    if (literal !== "") {
      parts.push({ color: spanColor, kind: "literal", value: literal });
      literal = "";
    }
  };

  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (char === "\\" && (source[i + 1] === "{" || source[i + 1] === "}")) {
      literal += source[i + 1];
      i += 2;
      continue;
    }
    if (char !== "{") {
      literal += char;
      i += 1;
      continue;
    }
    const close = source.indexOf("}", i);
    if (close === -1) {
      literal += char;
      i += 1;
      continue;
    }
    const raw = source.slice(i + 1, close);
    i = close + 1;

    // `{:color}...` opens a colored literal span, `{:/}` closes it.
    if (raw.startsWith(":")) {
      const body = raw.slice(1);
      if (body === "/") {
        flushLiteral();
        spanColor = undefined;
        continue;
      }
      flushLiteral();
      spanColor = body as ColorName;
      continue;
    }

    flushLiteral();
    const colonAt = raw.indexOf(":");
    const name = colonAt === -1 ? raw : raw.slice(0, colonAt);
    const color = colonAt === -1 ? spanColor : (raw.slice(colonAt + 1) as ColorName);
    const known =
      KNOWN_TOKENS.has(name) ||
      (name !== "" && name in ISO_FORMATTERS) ||
      (name !== "" && !name.includes("."));
    if (!known) {
      if (!warnedTokens.has(raw)) {
        warnedTokens.set(raw, true);
        console.warn(`hp_logger: unknown template token {${raw}}, rendered literally`);
      }
      parts.push({ kind: "literal", value: `{${raw}}` });
      continue;
    }
    parts.push({
      color,
      kind: "token",
      levelColored:
        color === undefined &&
        (name === "level.tag" || name === "elapsed" || name.startsWith("timestamp.")),
      value: name,
    });
  }
  flushLiteral();
  return parts;
};

interface CompiledTemplate {
  parts: TemplatePart[];
  source: string;
}

const templateCache = new WeakMap<object, CompiledTemplate>();

/** Parse a template setting object once per settings instance. */
export const compiledTemplate = (settings: { template: string }): CompiledTemplate => {
  const cached = templateCache.get(settings);
  if (cached !== undefined && cached.source === settings.template) return cached;
  const compiled = { parts: parseTemplate(settings.template), source: settings.template };
  templateCache.set(settings, compiled);
  return compiled;
};

const resolveTimestampField = (field: string, iso: string): string =>
  ISO_FORMATTERS[field]?.(iso) ?? "";

/** Tokens fed by task progress and database retry bookkeeping. */
const TASK_TOKENS = new Set(["retry.attempt", "task", "task.frame", "task.glyph"]);

const TASK_RENDERERS: Record<string, ((entry: LogEntry) => string) | undefined> = {
  "retry.attempt": (entry) => {
    const { attempt, attempts } = entry.context;
    return typeof attempt === "number"
      ? `${attempt}/${typeof attempts === "number" ? attempts : "?"}`
      : "";
  },
  task: (entry) => (typeof entry.context.task === "string" ? (entry.context.task as string) : ""),
  "task.frame": (entry) => {
    const { frame } = entry.context;
    return typeof frame === "number" ? (SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "") : "";
  },
  "task.glyph": (entry) => {
    const { status } = entry.context;
    return typeof status === "string" ? (TASK_GLYPHS[status] ?? "") : "";
  },
};

const resolveTaskToken = (name: string, entry: LogEntry): string =>
  TASK_RENDERERS[name]?.(entry) ?? "";

/** Built-in token renderers that need neither task bookkeeping nor the context fallback. */
const TOKEN_RENDERERS: Record<string, ((entry: LogEntry, env: TemplateEnv) => string) | undefined> =
  {
    author: (entry, env) => env.authorName(entry.author),
    context: (entry) => formatContext(entry.context, "json"),
    "context.kv": (entry) => formatContext(entry.context, "kv"),
    elapsed: (_entry, env) =>
      env.elapsedMs === null ? "" : `+${formatDuration(Math.round(env.elapsedMs()))}`,
    "group.indent": (entry) => {
      const { group } = entry.context;
      return typeof group === "string" && group !== ""
        ? "  ".repeat(Math.max(0, group.split(".").length - 1))
        : "";
    },
    level: (entry) => entry.level,
    "level.tag": (entry, env) => `[${caseTag(entry.level, env.tagCase)}]`,
    message: (entry) => entry.message,
  };

const resolveToken = (name: string, entry: LogEntry, env: TemplateEnv): string => {
  if (TASK_TOKENS.has(name)) return resolveTaskToken(name, entry);
  const custom = customTokens.get(name);
  if (custom !== undefined) {
    try {
      return custom(entry);
    } catch {
      // A broken renderer degrades to a visible marker instead of killing
      // the line; the throw surfaces in the caller's own console anyway.
      return "[TOKEN ERROR]";
    }
  }
  const builtin = TOKEN_RENDERERS[name];
  if (builtin !== undefined) return builtin(entry, env);
  if (name.startsWith("timestamp.")) {
    return resolveTimestampField(name.slice("timestamp.".length), entry.timestamp);
  }
  const value = entry.context[name];
  if (value === undefined) return "";
  if (typeof value === "object") return safeStringify(value);
  return String(value);
};

/** Render a parsed template for an entry; colors only when `env.colorize`. */
export const renderTemplate = (
  parts: TemplatePart[],
  entry: LogEntry,
  env: TemplateEnv,
): string => {
  let output = "";
  for (const part of parts) {
    const raw = part.kind === "literal" ? part.value : resolveToken(part.value, entry, env);
    if (raw === "") continue;
    const clean = env.stripControl ? stripControlCharacters(raw) : raw;
    const inherited = part.levelColored && part.color === undefined;
    const color =
      env.colorize === false
        ? undefined
        : (part.color ?? (inherited ? env.levelColor(entry.level) : undefined));
    output += color !== undefined && color !== false ? applyColor(color, clean) : clean;
  }
  return output;
};

/** Convenience wrapper used by transports holding a template settings object. */
export const renderTemplateSettings = (
  settings: { template: string },
  entry: LogEntry,
  env: TemplateEnv,
): string => renderTemplate(compiledTemplate(settings).parts, entry, env);

const TOKEN_NAME = /^[A-Za-z_]\w*$/u;

/**
 * Register a custom `{name}` token renderer. Names must be dotless (dotted
 * namespaces belong to built-ins) and cannot shadow reserved tokens;
 * registered tokens win over context keys of the same name, and
 * re-registering updates the renderer. A throwing renderer degrades to a
 * visible `[TOKEN ERROR]` marker instead of dropping the line.
 */
export const registerToken = (name: string, render: (entry: LogEntry) => string): void => {
  if (!TOKEN_NAME.test(name)) {
    throw new Error(`hp_logger: invalid token name "${name}" - use letters, digits, underscore`);
  }
  if (KNOWN_TOKENS.has(name) || TASK_TOKENS.has(name) || name in ISO_FORMATTERS) {
    throw new Error(`hp_logger: token "${name}" is reserved by a built-in`);
  }
  customTokens.set(name, render);
};
