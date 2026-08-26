/**
 * Bounded LRU cache. `Map` preserves insertion order, so `get` re-inserts
 * the key to mark it as most-recently-used and eviction drops the first
 * entry (the least-recently-used one).
 */
export interface LruCacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses); 0 until the first read. */
  hitRate: number;
  sets: number;
  /** Sets that replaced an existing key instead of inserting a new one. */
  reuseSets: number;
  evictions: number;
  /** Largest observed size since creation or the last resetStats(). */
  sizeWatermark: number;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private reuseSets = 0;
  private evictions = 0;
  private sizeWatermark = 0;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = Math.max(1, maxSize);
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    // Bump to the end on access so it survives eviction longer.
    this.map.delete(key);
    this.map.set(key, value);
    this.hits += 1;
    return value;
  }

  set(key: K, value: V): void {
    this.sets += 1;
    if (this.map.has(key)) {
      this.reuseSets += 1;
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next();
      if (!oldest.done) {
        const evicted = this.map.get(oldest.value);
        this.map.delete(oldest.value);
        this.evictions += 1;
        this.onEvict?.(oldest.value, evicted as V);
      }
    }
    this.map.set(key, value);
    if (this.map.size > this.sizeWatermark) this.sizeWatermark = this.map.size;
  }

  /** Peek at a value without changing recency order or hit/miss stats. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** All keys in current order (least-recently-used first). */
  keys(): K[] {
    return [...this.map.keys()];
  }

  clear(): void {
    // Explicit teardown is not eviction pressure: counters stay untouched.
    this.map.clear();
  }

  /** Frozen point-in-time counters for diagnostics and sizing decisions. */
  stats(): LruCacheStats {
    const reads = this.hits + this.misses;
    return Object.freeze({
      capacity: this.maxSize,
      evictions: this.evictions,
      hitRate: reads === 0 ? 0 : this.hits / reads,
      hits: this.hits,
      misses: this.misses,
      reuseSets: this.reuseSets,
      sets: this.sets,
      size: this.map.size,
      sizeWatermark: this.sizeWatermark,
    });
  }

  /** Zero the observation window; the watermark restarts from current size. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.reuseSets = 0;
    this.evictions = 0;
    this.sizeWatermark = this.map.size;
  }
}
