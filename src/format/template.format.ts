import { SPINNER_FRAMES, TASK_GLYPHS } from "../config/colors.config";
import { applyColor } from "../lib/color.utils";
import { stripControlCharacters } from "../lib/json.utils";
import type { ColorName, ContextFormat, LogEntry, LogLevel, TagCase } from "../types/logger";
import { formatContext } from "./context.format";
import { formatDuration } from "./duration.format";
import { caseTag } from "./tag.format";

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

const warnedTokens = new Set<string>();

const ISO_FIELD_RANGES: Record<string, [number, number]> = {
  day: [8, 10],
  hour: [11, 13],
  minute: [14, 16],
  month: [5, 7],
  ms: [20, 23],
  second: [17, 19],
  year: [0, 4],
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
      ISO_FIELD_RANGES[name] !== undefined ||
      (name !== "" && !name.includes("."));
    if (!known) {
      if (!warnedTokens.has(raw)) {
        warnedTokens.add(raw);
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

const resolveTimestampField = (field: string, iso: string): string => {
  switch (field) {
    case "": {
      return iso;
    }
    case "date": {
      return iso.slice(5, 10);
    }
    case "time": {
      return iso.slice(11, 19);
    }
    case "weekday": {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? "" : date.toUTCString().slice(0, 3);
    }
    default: {
      const range = ISO_FIELD_RANGES[field];
      if (range === undefined) return "";
      const [start, end] = range;
      return iso.slice(start, end);
    }
  }
};

/** Tokens fed by task progress and database retry bookkeeping. */
const TASK_TOKENS = new Set(["retry.attempt", "task", "task.frame", "task.glyph"]);

const resolveTaskToken = (name: string, entry: LogEntry): string => {
  switch (name) {
    case "retry.attempt": {
      const { attempt, attempts } = entry.context;
      return typeof attempt === "number"
        ? `${attempt}/${typeof attempts === "number" ? attempts : "?"}`
        : "";
    }
    case "task": {
      return typeof entry.context.task === "string" ? (entry.context.task as string) : "";
    }
    case "task.frame": {
      const { frame } = entry.context;
      return typeof frame === "number" ? (SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "") : "";
    }
    default: {
      // "task.glyph": the only remaining task token.
      const { status } = entry.context;
      return typeof status === "string" ? (TASK_GLYPHS[status] ?? "") : "";
    }
  }
};

const resolveToken = (name: string, entry: LogEntry, env: TemplateEnv): string => {
  if (TASK_TOKENS.has(name)) return resolveTaskToken(name, entry);
  switch (name) {
    case "author": {
      return env.authorName(entry.author);
    }
    case "context": {
      return formatContext(entry.context, "json");
    }
    case "context.kv": {
      return formatContext(entry.context, "kv");
    }
    case "elapsed": {
      return env.elapsedMs === null ? "" : `+${formatDuration(Math.round(env.elapsedMs()))}`;
    }
    case "group.indent": {
      const { group } = entry.context;
      return typeof group === "string" && group !== ""
        ? "  ".repeat(Math.max(0, group.split(".").length - 1))
        : "";
    }
    case "level": {
      return entry.level;
    }
    case "level.tag": {
      return `[${caseTag(entry.level, env.tagCase)}]`;
    }
    case "message": {
      return entry.message;
    }
    default: {
      if (name.startsWith("timestamp.")) {
        return resolveTimestampField(name.slice("timestamp.".length), entry.timestamp);
      }
      const value = entry.context[name];
      if (value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
  }
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
