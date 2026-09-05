import type { LogEntry } from "../types/logger.js";

/**
 * Deterministic polynomial string hash: tiny, stable across runs, and
 * bitwise-free so it works under strict lint configs. Good enough for
 * coherent sampling decisions.
 */
const hashString = (value: string): number => {
  const modulus = 2_147_483_647;
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code === undefined) continue;
    hash = (hash * 31 + code) % modulus;
  }
  return hash;
};

export type Sampler = (entry: LogEntry) => boolean;

/**
 * Trace-coherent sampling: entries carrying a traceId are kept or dropped
 * as a whole trace (deterministic hash), so a sampled-out trace loses all
 * of its entries, not random middle pieces. Entries without a traceId are
 * sampled individually. error/fatal bypass sampling upstream.
 */
export const createSampler = (rate: number, perTrace: boolean): Sampler => {
  const clamped = Math.min(1, Math.max(0, rate));
  const threshold = Math.round(clamped * 2_147_483_646);
  return (entry: LogEntry): boolean => {
    const { traceId } = entry.context;
    const key =
      perTrace && typeof traceId === "string"
        ? traceId
        : `${entry.timestamp}:${entry.author}:${entry.message}`;
    return hashString(key) <= threshold;
  };
};
