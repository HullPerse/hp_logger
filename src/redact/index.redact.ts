import { Memoize } from "../brain/memo.utils";
import { registerBrainCache } from "../brain/registry.utils";
import {
  BEARER_PATTERN,
  CARD_PATTERN,
  EMAIL_PATTERN,
  KEY_VALUE_PATTERN,
  MESSAGE_REDACTION_PATTERN,
  DEFAULT_REDACT_KEYS,
  SENSITIVE_KEY_FRAGMENTS,
} from "../config/redaction.config";
import type { SerializedError } from "../types/redact";

const matchesPattern = (pattern: RegExp, value: string): boolean => {
  // Non-stateful expressions do not need lastIndex writes on every key.
  if (!pattern.global && !pattern.sticky) return pattern.test(value);
  // Custom expressions may be stateful (`g`/`y`). Keep repeated redaction
  // calls deterministic instead of letting lastIndex leak between entries.
  pattern.lastIndex = 0;
  const matched = pattern.test(value);
  pattern.lastIndex = 0;
  return matched;
};

// Key matches repeat across entries (authorization, token, password in
// every request); cache the per-key verdict. Bounded, so the cache cannot
// grow without limit when keys vary. Values are not cached: strings carry
// the bulk of redaction cost and their space is unbounded.
const secretKeyMemo = new Memoize<string, boolean>(2048);
registerBrainCache("redact.secretKey", () => secretKeyMemo.stats());

const matchesSecretKey = (key: string, secretKey: RegExp): boolean => {
  if (secretKey !== DEFAULT_REDACT_KEYS) return matchesPattern(secretKey, key);
  return secretKeyMemo.call(key, () => SENSITIVE_KEY_FRAGMENTS.test(key));
};

/**
 * Path redaction: exact dot paths plus a trailing `.*` wildcard that masks
 * everything under the prefix. `user.password` hits only that path;
 * `secrets.*` hits `secrets.token` and anything deeper. Settings-time
 * callers compile their path list once into set/prefix lookups instead of
 * re-parsing patterns on every scanned key.
 */
export interface CompiledRedactPaths {
  /** Patterns without a wildcard, plus wildcard bases ("secrets" for "secrets.*"). */
  exact: Set<string>;
  /** Wildcard bases with a trailing dot ("secrets."). */
  prefixes: string[];
}

export const compileRedactPaths = (paths: string[]): CompiledRedactPaths | null => {
  if (paths.length === 0) return null;
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const pattern of paths) {
    if (pattern.endsWith(".*")) {
      const base = pattern.slice(0, -2);
      // The wildcard also masks the bare parent path itself, matching the
      // historical string-scan semantics.
      exact.add(base);
      prefixes.push(`${base}.`);
    } else {
      exact.add(pattern);
    }
  }
  return { exact, prefixes };
};

const readChild = (source: Record<string, unknown>, key: string): unknown => {
  try {
    return source[key];
  } catch {
    return "[REDACTED]";
  }
};
const pathMatches = (currentPath: string, compiled: CompiledRedactPaths): boolean => {
  if (compiled.exact.has(currentPath)) return true;
  for (const prefix of compiled.prefixes) {
    if (currentPath.startsWith(prefix)) return true;
  }
  return false;
};

const needsRedactionScan = (
  key: string,
  value: unknown,
  secretKey: RegExp | null,
  childPath: string,
  compiled: CompiledRedactPaths | null,
  pii: { card: boolean; email: boolean } | false,
): boolean => {
  if (compiled !== null && pathMatches(childPath, compiled)) return true;
  if (secretKey !== null && matchesSecretKey(key, secretKey)) return true;
  if (typeof value === "string") {
    if (pii !== false) return true;
    return secretKey !== null && matchesPattern(MESSAGE_REDACTION_PATTERN, value);
  }
  return typeof value === "object" && value !== null;
};

const MAX_ERROR_DEPTH = 8;

/**
 * Brand on serialized errors: redaction and repeated build passes skip
 * already-expanded errors instead of re-walking their long stack strings
 * with message regexes. Non-enumerable, so JSON output is unaffected.
 */
const SERIALIZED_ERROR_BRAND: unique symbol = Symbol("hp_logger.serializedError") as never;

export const isSerializedError = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as { [SERIALIZED_ERROR_BRAND]?: boolean })[SERIALIZED_ERROR_BRAND] === true;

// Cycles and shared references are guarded per branch: `seen` is released
// after each recursion, so a DAG renders fully and only true cycles stop.
export const serializeError = (
  error: Error,
  seen = new WeakSet<Error>(),
  depth = 0,
): SerializedError => {
  if (depth > MAX_ERROR_DEPTH) {
    return { message: "[Nested]", name: error.name };
  }
  if (seen.has(error)) {
    return { message: "[Circular]", name: error.name };
  }
  seen.add(error);
  const result: SerializedError = { message: error.message, name: error.name };
  if (error.stack) result.stack = error.stack;
  if (error.cause !== undefined) {
    result.cause =
      error.cause instanceof Error ? serializeError(error.cause, seen, depth + 1) : error.cause;
  }
  seen.delete(error);
  Object.defineProperty(result, SERIALIZED_ERROR_BRAND, { value: true });
  return result;
};

type RedactFn = (
  value: unknown,
  secretKey: RegExp | null,
  censor: string,
  pii: { card: boolean; email: boolean } | false,
  maxDepth: number,
  depth: number,
  compiled: CompiledRedactPaths | null,
  currentPath: string,
) => unknown;

const resolveRedactChild = (
  key: string,
  child: unknown,
  childPath: string,
  secretKey: RegExp | null,
  censor: string,
  pii: { card: boolean; email: boolean } | false,
  maxDepth: number,
  depth: number,
  compiled: CompiledRedactPaths | null,
  currentPath: string,
  redactFn: RedactFn,
): unknown => {
  if (compiled !== null && pathMatches(childPath, compiled)) return censor;
  if (secretKey !== null && matchesSecretKey(key, secretKey)) return censor;
  return redactFn(child, secretKey, censor, pii, maxDepth, depth + 1, compiled, childPath);
};

const redactObject = (
  value: Record<string, unknown>,
  secretKey: RegExp | null,
  censor: string,
  pii: { card: boolean; email: boolean } | false,
  maxDepth: number,
  depth: number,
  compiled: CompiledRedactPaths | null,
  currentPath: string,
  redactFn: RedactFn,
): unknown => {
  if (secretKey === null && compiled === null && pii === false) return value;
  const keys = Object.keys(value);
  let needsCopy = false;
  for (const key of keys) {
    const child = readChild(value, key);
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    if (needsRedactionScan(key, child, secretKey, childPath, compiled, pii)) {
      needsCopy = true;
      break;
    }
  }
  if (!needsCopy) return value;

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const child = readChild(value, key);
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    result[key] = resolveRedactChild(
      key,
      child,
      childPath,
      secretKey,
      censor,
      pii,
      maxDepth,
      depth,
      compiled,
      currentPath,
      redactFn,
    );
  }
  return result;
};

/** Apply PII free-text detectors to a string value. */
const applyPiiRedaction = (
  value: string,
  pii: { card: boolean; email: boolean },
  censor: string,
): string => {
  let result = value;
  if (pii.email) result = result.replaceAll(EMAIL_PATTERN, censor);
  if (pii.card) result = result.replaceAll(CARD_PATTERN, censor);
  return result;
};

const redactInternal = (
  value: unknown,
  secretKey: RegExp | null,
  censor: string,
  pii: { card: boolean; email: boolean } | false,
  maxDepth: number,
  depth: number,
  compiled: CompiledRedactPaths | null,
  currentPath: string,
): unknown => {
  if (depth > maxDepth) return censor;

  if (value instanceof Error) return serializeError(value);
  // An already-expanded error (built by the entry plan) is final data:
  // re-walking it would only rescan long stack strings.
  if (isSerializedError(value)) return value;

  if (typeof value === "string") {
    let result = value;
    if (secretKey !== null && MESSAGE_REDACTION_PATTERN.test(value)) {
      result = result
        .replaceAll(BEARER_PATTERN, `Bearer ${censor}`)
        .replaceAll(KEY_VALUE_PATTERN, `$<key>=${censor}`);
    }
    if (pii !== false) result = applyPiiRedaction(result, pii, censor);
    return result;
  }

  if (Array.isArray(value)) return `[${value.length} items]`;

  if (typeof value === "object" && value !== null) {
    return redactObject(
      value as Record<string, unknown>,
      secretKey,
      censor,
      pii,
      maxDepth,
      depth,
      compiled,
      currentPath,
      redactInternal,
    );
  }

  return value;
};

/** Public helper: compiles the path list per call (cold path). */
export const redact = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth = 2,
  depth = 0,
  paths: string[] = [],
  currentPath = "",
): unknown =>
  redactInternal(value, secretKey, "[REDACTED]", false, maxDepth, depth, compileRedactPaths(paths), currentPath);

/** Settings-time entry point: the path list was compiled once per settings change. */
export const redactCompiled = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth: number,
  compiled: CompiledRedactPaths | null,
  censor = "[REDACTED]",
  pii: { card: boolean; email: boolean } | false = false,
): unknown => redactInternal(value, secretKey, censor, pii, maxDepth, 0, compiled, "");
