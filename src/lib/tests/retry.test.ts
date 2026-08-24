import { describe, expect, test } from "bun:test";

import {
  RETRY_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  applyJitter,
  resolveRetry,
  retryDelayMs,
} from "@/lib/retry.utils";
import type { RetrySettings } from "@/types/transport";

const mustResolve = (settings: RetrySettings) => {
  const resolved = resolveRetry(settings);
  if (resolved === null) throw new Error("expected settings to resolve");
  return resolved;
};

describe("resolveRetry", () => {
  test("returns null for disabled or missing settings", () => {
    expect(resolveRetry()).toBeNull();
    expect(resolveRetry(false)).toBeNull();
  });

  test("applies documented defaults", () => {
    const retry = resolveRetry({});
    expect(retry).toEqual({
      attempts: RETRY_ATTEMPTS,
      backoff: "exponential",
      baseMs: RETRY_BASE_MS,
      jitter: 0,
      maxMs: RETRY_MAX_MS,
    });
    expect(RETRY_ATTEMPTS).toBe(5);
  });

  test("clamps invalid values instead of throwing", () => {
    const retry = resolveRetry({ attempts: 0, baseMs: -5, jitter: 7 });
    expect(retry?.attempts).toBe(1);
    expect(retry?.baseMs).toBe(0);
    expect(retry?.jitter).toBe(1);
  });

  test("never allows a wait above baseMs when maxMs is lower", () => {
    const retry = resolveRetry({ baseMs: 500, maxMs: 100 });
    expect(retry?.maxMs).toBe(500);
  });
});

describe("retryDelayMs", () => {
  const base = { baseMs: 100, jitter: 0, maxMs: 10_000 };

  test("doubles the delay on exponential backoff", () => {
    const retry = mustResolve({ ...base, backoff: "exponential" });
    expect(retryDelayMs(retry, 1)).toBe(100);
    expect(retryDelayMs(retry, 2)).toBe(200);
    expect(retryDelayMs(retry, 3)).toBe(400);
  });

  test("grows linearly on linear backoff", () => {
    const retry = mustResolve({ ...base, backoff: "linear" });
    expect(retryDelayMs(retry, 1)).toBe(100);
    expect(retryDelayMs(retry, 2)).toBe(200);
    expect(retryDelayMs(retry, 3)).toBe(300);
  });

  test("stays flat on fixed backoff", () => {
    const retry = mustResolve({ ...base, backoff: "fixed" });
    expect(retryDelayMs(retry, 1)).toBe(100);
    expect(retryDelayMs(retry, 9)).toBe(100);
  });

  test("caps every delay at maxMs", () => {
    const retry = mustResolve({ ...base, backoff: "exponential", maxMs: 250 });
    expect(retryDelayMs(retry, 4)).toBe(250);
    expect(retryDelayMs(retry, 20)).toBe(250);
  });
});

describe("applyJitter", () => {
  test("keeps the exact delay without jitter", () => {
    expect(applyJitter(400, 0)).toBe(400);
  });

  test("stays within the +/- jitter share across many draws", () => {
    for (let i = 0; i < 200; i += 1) {
      const value = applyJitter(1000, 0.25);
      expect(value).toBeGreaterThanOrEqual(750);
      expect(value).toBeLessThanOrEqual(1250);
    }
  });

  test("returns the delay unchanged for zero or negative delays", () => {
    expect(applyJitter(0, 0.5)).toBe(0);
  });
});
