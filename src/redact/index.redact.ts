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

const matchesSecretKey = (key: string, secretKey: RegExp): boolean =>
  secretKey === DEFAULT_REDACT_KEYS
    ? SENSITIVE_KEY_FRAGMENTS.test(key)
    : matchesPattern(secretKey, key);

const needsRedactionScan = (key: string, value: unknown, secretKey: RegExp): boolean => {
  if (matchesSecretKey(key, secretKey)) return true;
  if (typeof value === "string") {
    return matchesPattern(MESSAGE_REDACTION_PATTERN, value);
  }
  return typeof value === "object" && value !== null;
};

const serializeError = (error: Error): SerializedError => {
  const result: SerializedError = { message: error.message, name: error.name };
  if (error.stack) result.stack = error.stack;
  if (error.cause !== undefined) {
    result.cause = error.cause instanceof Error ? serializeError(error.cause) : error.cause;
  }
  return result;
};

export const redact = (
  value: unknown,
  secretKey: RegExp | null,
  maxDepth = 2,
  depth = 0,
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
    // Fast path: no candidate keys and no nested objects/Errors to
    // serialize -> nothing to mask, return as-is without copying.
    if (secretKey === null) return value;
    const keys = Object.keys(value);
    let needsCopy = false;
    for (const key of keys) {
      const child = (value as Record<string, unknown>)[key];
      if (needsRedactionScan(key, child, secretKey)) {
        needsCopy = true;
        break;
      }
    }
    if (!needsCopy) return value;

    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const child = (value as Record<string, unknown>)[key];
      result[key] = matchesSecretKey(key, secretKey)
        ? "[REDACTED]"
        : redact(child, secretKey, maxDepth, depth + 1);
    }
    return result;
  }

  return value;
};
