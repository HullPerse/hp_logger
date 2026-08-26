/** Immutable counters for one memoizer instance. */
export interface MemoizeStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses); 0 until the first read. */
  hitRate: number;
  evictions: number;
  /** Misses on keys recently evicted by the cap: churn from our own bound. */
  recomputesAfterEvict: number;
  /** Largest observed size since creation or the last resetStats(). */
  sizeWatermark: number;
}

/** Simple memoizer with a bounded result cache. */
export class Memoize<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly maxSize: number;
  // Keys evicted and not seen again; a bounded tombstone set used to
  // attribute later misses to our own eviction pressure instead of to
  // genuinely new keys.
  private readonly evictedKeys = new Set<K>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private recomputesAfterEvict = 0;
  private sizeWatermark = 0;

  constructor(maxSize = 1000) {
    this.maxSize = Math.max(1, maxSize);
  }

  /** Compute `fn(key)` once per key and return the cached result. */
  call(key: K, fn: () => V): V {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      return cached;
    }
    this.misses += 1;
    if (this.evictedKeys.delete(key)) this.recomputesAfterEvict += 1;
    const value = fn();
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
        this.evictions += 1;
        this.evictedKeys.add(oldest.value);
        if (this.evictedKeys.size > this.maxSize) {
          const stale = this.evictedKeys.keys().next();
          if (!stale.done) this.evictedKeys.delete(stale.value);
        }
      }
    }
    this.cache.set(key, value);
    if (this.cache.size > this.sizeWatermark) this.sizeWatermark = this.cache.size;
    return value;
  }

  clear(): void {
    // Tombstones track cache contents, so they reset together with it.
    this.cache.clear();
    this.evictedKeys.clear();
  }

  /** Frozen point-in-time counters for diagnostics and sizing decisions. */
  stats(): MemoizeStats {
    const reads = this.hits + this.misses;
    return Object.freeze({
      capacity: this.maxSize,
      evictions: this.evictions,
      hitRate: reads === 0 ? 0 : this.hits / reads,
      hits: this.hits,
      misses: this.misses,
      recomputesAfterEvict: this.recomputesAfterEvict,
      size: this.cache.size,
      sizeWatermark: this.sizeWatermark,
    });
  }

  /** Zero the observation window; the watermark restarts from current size. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.recomputesAfterEvict = 0;
    this.sizeWatermark = this.cache.size;
  }
}
