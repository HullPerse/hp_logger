import { LruCache } from "../brain/lru.utils.js";
import {
  DEFAULT_OPERATION_BUCKETS,
  OPERATION_METRIC_NAME,
  PROFILE_OVERFLOW_LABEL,
} from "../config/metrics.config.js";
import { Histogram } from "./histogram.metric.js";
import type { Registry } from "./registry.metric.js";

/**
 * Aggregates every time()/span()/task() duration into one operation
 * histogram. The LRU bounds distinct operation labels before they reach
 * the histogram, so its label map can never grow past the cap; names
 * beyond the cap share the overflow label. Capacity is fixed at
 * construction: a mid-flight maxOperations change keeps the original cap.
 */
export class OperationProfiler {
  private readonly cache: LruCache<string, string>;
  private readonly histogram: Histogram;
  private readonly maxOperations: number;

  constructor(registry: Registry, maxOperations: number) {
    this.maxOperations = Math.max(1, maxOperations);
    this.cache = new LruCache(this.maxOperations);
    this.histogram = new Histogram({
      buckets: DEFAULT_OPERATION_BUCKETS,
      help: "Duration of measured operations (time/span/task)",
      labelNames: ["operation"],
      name: OPERATION_METRIC_NAME,
      registers: [registry],
    });
  }

  /** Record one measured duration under its (bounded) operation label. */
  record(name: string, durationMs: number): void {
    let operation = this.cache.get(name);
    if (operation === undefined) {
      // Cache full: the name maps to the shared overflow label. Caching
      // that mapping keeps repeated overflow names on the fast hit path,
      // at the cost of evicting one tracked label per distinct new name.
      operation = this.cache.size >= this.maxOperations ? PROFILE_OVERFLOW_LABEL : name;
      this.cache.set(name, operation);
    }
    this.histogram.observe({ operation }, durationMs);
  }

  /** Frozen label-cache counters, exposed by Logger.stats() as profileCache. */
  stats() {
    return this.cache.stats();
  }
}
