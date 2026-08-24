import { Memoize } from "../brain/memo.utils";
import {
  BEARER_PATTERN,
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

const matchesSecretKey = (key: string, secretKey: RegExp): boolean => {
  if (secretKey !== DEFAULT_REDACT_KEYS) return matchesPattern(secretKey, key);
  return secretKeyMemo.call(key, () => SENSITIVE_KEY_FRAGMENTS.test(key));
};

/**
 * Path redaction: exact dot paths plus a trailing `.*` wildcard that masks
 * everything under the prefix. `user.password` hits only that path;
 * `secrets.*` hits `secrets.token` and anything deeper.
 */
const readChild = (source: Record<string, unknown>, key: string): unknown => {
  try {
    return source[key];
  } catch {
    return "[REDACTED]";
  }
};
const pathMatches = (currentPath: string, paths: string[]): boolean => {
  for (const pattern of paths) {
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      if (currentPath === prefix || currentPath.startsWith(`${prefix}.`)) return true;
    } else if (pattern === currentPath) {
      return true;
    }
  }
  return false;
};

const needsRedactionScan = (
  key: string,
  value: unknown,
  secretKey: RegExp | null,
  childPath: string,
  paths: string[],
): boolean => {
  if (paths.length > 0 && pathMatches(childPath, paths)) return true;
  if (secretKey !== null && matchesSecretKey(key, secretKey)) return true;
  if (typeof value === "string") {
    return secretKey !== null && matchesPattern(MESSAGE_REDACTION_PATTERN, value);
  }
  return typeof value === "object" && value !== null;
};

const MAX_ERROR_DEPTH = 8;

// Cycles and shared references are guarded per branch: `seen` is released
// after each recursion, so a DAG renders fully and only true cycles stop.
const serializeError = (error: Error, seen = new WeakSet<Error>(), depth = 0): SerializedError => {
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
  return result;
};

type RedactFn = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth: number,
  depth: number,
  paths: string[],
  currentPath: string,
) => unknown;

const resolveRedactChild = (
  key: string,
  child: unknown,
  childPath: string,
  secretKey: RegExp | null,
  maxDepth: number,
  depth: number,
  paths: string[],
  currentPath: string,
  redactFn: RedactFn,
): unknown => {
  if (paths.length > 0 && pathMatches(childPath, paths)) return "[REDACTED]";
  if (secretKey !== null && matchesSecretKey(key, secretKey)) return "[REDACTED]";
  return redactFn(child, secretKey, maxDepth, depth + 1, paths, childPath);
};

const redactObject = (
  value: Record<string, unknown>,
  secretKey: RegExp | null,
  maxDepth: number,
  depth: number,
  paths: string[],
  currentPath: string,
  redactFn: RedactFn,
): unknown => {
  if (secretKey === null && paths.length === 0) return value;
  const keys = Object.keys(value);
  let needsCopy = false;
  for (const key of keys) {
    const child = readChild(value, key);
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    if (needsRedactionScan(key, child, secretKey, childPath, paths)) {
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
      maxDepth,
      depth,
      paths,
      currentPath,
      redactFn,
    );
  }
  return result;
};

export const redact = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth = 2,
  depth = 0,
  paths: string[] = [],
  currentPath = "",
): unknown => {
  if (depth > maxDepth) return "[REDACTED]";

  if (value instanceof Error) return serializeError(value);

  if (typeof value === "string") {
    if (secretKey === null || !MESSAGE_REDACTION_PATTERN.test(value)) return value;
    return value
      .replaceAll(BEARER_PATTERN, "Bearer [REDACTED]")
      .replaceAll(KEY_VALUE_PATTERN, "$<key>=[REDACTED]");
  }

  if (Array.isArray(value)) return `[${value.length} items]`;

  if (typeof value === "object" && value !== null) {
    return redactObject(
      value as Record<string, unknown>,
      secretKey,
      maxDepth,
      depth,
      paths,
      currentPath,
      redact,
    );
  }

  return value;
};
