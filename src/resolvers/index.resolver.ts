import { registerBrainCache } from "../brain/registry.utils";
import { TtlCache } from "../brain/ttl.utils";
import { startUnrefTimeout, stopTimeout } from "../lib/transport.utils";
import type {
  LogContext,
  ResolverEntry,
  ResolverSet as ResolverSetShape,
  ResolverSettings,
} from "../types/logger";

/** One configured resolver: how to translate a context key and how to cache. */
export interface ResolvedResolver {
  /** Target field for scalar results; object results merge their own keys. */
  as?: string;
  onError: "skip" | "mark";
  resolve: (value: unknown) => unknown | Promise<unknown>;
  timeoutMs: number;
  ttlMs: number;
}

/** A finished lookup: cache key plus the fields to merge into the entry. */
interface LookupResult {
  cacheKey: string;
  fields: Record<string, unknown>;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 50;
const DEFAULT_CACHE_CAP = 8192;
const ERROR_MARKER = "[RESOLVER ERROR]";

// Every ResolverSet owns its own bounded cache (per-logger isolation), so
// the brain provider aggregates over live instances. A closed-but-dropped
// logger stays listed here until process end: the ceiling is one entry per
// resolver configuration ever created, not per log entry.
const liveCaches = new Set<TtlCache<string, Record<string, unknown>>>();

registerBrainCache("resolvers.enrichment", () => {
  let capacity = 0;
  let evictions = 0;
  let expired = 0;
  let hits = 0;
  let misses = 0;
  let size = 0;
  let sizeWatermark = 0;
  for (const cache of liveCaches) {
    const stats = cache.stats();
    capacity = Math.max(capacity, stats.capacity);
    evictions += stats.evictions;
    expired += stats.expired;
    hits += stats.hits;
    misses += stats.misses;
    size += stats.size;
    sizeWatermark = Math.max(sizeWatermark, stats.sizeWatermark);
  }
  const reads = hits + misses;
  return Object.freeze({
    capacity,
    evictions,
    expired,
    hitRate: reads === 0 ? 0 : hits / reads,
    hits,
    misses,
    size,
    sizeWatermark,
  });
});

const TIMEOUT = Symbol("resolver-timeout");
const RESOLVER_ERROR = Symbol("resolver-error");
type ResolveOutcome = unknown | typeof TIMEOUT | typeof RESOLVER_ERROR;

/**
 * One resolver set, owned by a logger. Holds the config plus the shared
 * bounded cache, so two loggers with different resolver maps never collide
 * on keys. Concurrent lookups for the same value share one in-flight call.
 */
export class ResolverSet implements ResolverSetShape {
  private readonly cache = new TtlCache<string, Record<string, unknown>>(DEFAULT_CACHE_CAP);
  private readonly config = new Map<string, ResolvedResolver>();
  private readonly inFlight = new Map<string, Promise<LookupResult | undefined>>();

  constructor(settings: ResolverSettings) {
    liveCaches.add(this.cache);
    for (const [key, entry] of Object.entries(settings)) {
      this.config.set(key, ResolverSet.normalize(entry));
    }
  }

  get size(): number {
    return this.config.size;
  }

  get(key: string): ResolvedResolver | undefined {
    return this.config.get(key);
  }

  /** True when any context key has a configured resolver. */
  hasAny(context: LogContext): boolean {
    return Object.keys(context).some((key) => this.config.has(key));
  }

  /** Wait until every currently active lookup has settled. */
  async waitForIdle(): Promise<void> {
    const active = [...this.inFlight.values()];
    if (active.length > 0) await Promise.all(active);
  }

  /** Translate every resolvable context key; returns additions only. */
  async resolveAll(context: LogContext): Promise<Record<string, unknown>> {
    const additions: Record<string, unknown> = {};
    const lookups: Promise<LookupResult | undefined>[] = [];
    for (const [key, value] of Object.entries(context)) {
      const entry = this.config.get(key);
      if (entry === undefined || value === undefined || value === null) continue;
      const cacheKey = `${key}:${typeof value}:${String(value)}`;
      const warm = this.cache.get(cacheKey, Date.now());
      if (warm !== undefined) {
        Object.assign(additions, warm);
        continue;
      }
      lookups.push(this.dedupe(cacheKey, key, value, entry));
    }
    if (lookups.length > 0) {
      const results = await Promise.all(lookups);
      for (const result of results) {
        if (result === undefined) continue;
        Object.assign(additions, result.fields);
      }
    }
    return additions;
  }

  /** Reuse an in-flight lookup for the same cache key, or start one. */
  private dedupe(
    cacheKey: string,
    key: string,
    value: unknown,
    entry: ResolvedResolver,
  ): Promise<LookupResult | undefined> {
    const running = this.inFlight.get(cacheKey);
    if (running !== undefined) return running;
    const started = this.lookup(cacheKey, key, value, entry);
    this.inFlight.set(cacheKey, started);
    return started;
  }

  private async lookup(
    cacheKey: string,
    key: string,
    value: unknown,
    entry: ResolvedResolver,
  ): Promise<LookupResult | undefined> {
    try {
      const outcome = await ResolverSet.timedResolve(entry, value);
      if (outcome === TIMEOUT) return undefined;
      if (outcome === RESOLVER_ERROR) {
        const fields = entry.onError === "mark" ? { [key]: ERROR_MARKER } : undefined;
        return fields === undefined ? undefined : { cacheKey, fields };
      }
      const fields = ResolverSet.toFields(entry, outcome);
      if (fields !== undefined) {
        this.cache.set(cacheKey, fields, entry.ttlMs, Date.now());
        return { cacheKey, fields };
      }
      return undefined;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /** Shape the resolver outcome into additions: objects merge, scalars land under `as`. */
  private static toFields(
    entry: ResolvedResolver,
    outcome: unknown,
  ): Record<string, unknown> | undefined {
    if (outcome === null || outcome === undefined) return undefined;
    if (typeof outcome === "object") return outcome as Record<string, unknown>;
    if (entry.as === undefined) return undefined;
    return { [entry.as]: outcome };
  }

  private static normalize(entry: ResolverEntry): ResolvedResolver {
    return {
      as: entry.as,
      onError: entry.onError ?? "skip",
      resolve: entry.resolve,
      timeoutMs: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ttlMs: entry.ttlMs ?? DEFAULT_TTL_MS,
    };
  }

  /** Run the lookup with a hard deadline; errors and timeouts map to markers. */
  private static async timedResolve(
    entry: ResolvedResolver,
    value: unknown,
  ): Promise<ResolveOutcome> {
    const promise = Promise.resolve(entry.resolve(value));
    const { promise: deadline, resolve: timeout } = Promise.withResolvers<typeof TIMEOUT>();
    const timer = startUnrefTimeout(() => timeout(TIMEOUT), entry.timeoutMs);
    try {
      return await Promise.race([promise, deadline]);
    } catch {
      return RESOLVER_ERROR;
    } finally {
      stopTimeout(timer);
    }
  }
}

/** Build a ResolverSet from settings, or false when disabled/empty. */
export const buildResolverSet = (
  settings: ResolverSettings | false | undefined,
): ResolverSet | false => {
  if (!settings || Object.keys(settings).length === 0) return false;
  return new ResolverSet(settings);
};
