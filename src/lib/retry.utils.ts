import type { RetrySettings } from "../types/transport";

export interface ResolvedRetry {
  attempts: number;
  backoff: "exponential" | "linear" | "fixed";
  baseMs: number;
  maxMs: number;
  jitter: number;
}

export const RETRY_ATTEMPTS = 5;
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;

/** Normalize user retry settings; `null` keeps the legacy immediate-retry behavior. */
export const resolveRetry = (settings?: RetrySettings | false): ResolvedRetry | null => {
  if (!settings) return null;
  const baseMs = Math.max(0, settings.baseMs ?? RETRY_BASE_MS);
  return {
    attempts: Math.max(1, settings.attempts ?? RETRY_ATTEMPTS),
    backoff: settings.backoff ?? "exponential",
    baseMs,
    jitter: Math.min(1, Math.max(0, settings.jitter ?? 0)),
    maxMs: Math.max(baseMs, settings.maxMs ?? RETRY_MAX_MS),
  };
};

/** Deterministic wait before retry attempt (1-based), before jitter. */
export const retryDelayMs = (retry: ResolvedRetry, attempt: number): number => {
  let raw = retry.baseMs;
  if (retry.backoff === "linear") {
    raw = retry.baseMs * attempt;
  } else if (retry.backoff === "exponential") {
    raw = retry.baseMs * 2 ** (attempt - 1);
  }
  return Math.min(raw, retry.maxMs);
};

/** Spread a wait by +/- the jitter share so concurrent writers do not sync up. */
export const applyJitter = (delayMs: number, jitter: number): number => {
  if (jitter <= 0 || delayMs <= 0) return delayMs;
  const spread = delayMs * jitter;
  return delayMs - spread + Math.random() * spread * 2;
};
