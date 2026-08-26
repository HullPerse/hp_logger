/** Immutable counters for one TTL cache instance. */
export interface TtlCacheStats {
  capacity: number;
  size: number;
  hits: number;
  misses: number;
  /** Misses where the key existed but its TTL had passed (a subset of misses). */
  expired: number;
  evictions: number;
  /** hits / (hits + misses); 0 until the first read. */
  hitRate: number;
  /** Largest observed size since creation or the last resetStats(). */
  sizeWatermark: number;
}

/**
 * Bounded LRU cache where every entry carries its own expiry. Reads past
 * `expiresAt` count as misses and drop the key; overflow evicts the
 * least-recently-used entry exactly like `LruCache`. The clock comes from
 * the caller (`now`), so tests and callers control time.
 */
export class TtlCache<K, V> {
  private readonly map = new Map<K, { expiresAt: number; value: V }>();
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;
  private expired = 0;
  private evictions = 0;
  private sizeWatermark = 0;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  get size(): number {
    return this.map.size;
  }

  /** Live value for `key`, or undefined on miss, eviction, or expiry. */
  get(key: K, now: number): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= now) {
      // Drop the dead key so a later `size` read reflects live entries only.
      this.misses += 1;
      this.expired += 1;
      this.map.delete(key);
      return undefined;
    }
    // Bump to the end on access so it survives eviction longer.
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /** Store `value` under `key` for `ttlMs` from `now`; refreshes recency. */
  set(key: K, value: V, ttlMs: number, now: number): void {
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      const oldest = this.map.keys().next();
      if (!oldest.done) {
        this.map.delete(oldest.value);
        this.evictions += 1;
      }
    }
    this.map.delete(key);
    this.map.set(key, { expiresAt: now + ttlMs, value });
    if (this.map.size > this.sizeWatermark) this.sizeWatermark = this.map.size;
  }

  /** Read without touching recency order or any counter; expired values hide. */
  peek(key: K, now: number): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined || entry.expiresAt <= now) return undefined;
    return entry.value;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Frozen point-in-time counters for diagnostics and sizing decisions. */
  stats(): TtlCacheStats {
    const reads = this.hits + this.misses;
    return Object.freeze({
      capacity: this.maxSize,
      evictions: this.evictions,
      expired: this.expired,
      hitRate: reads === 0 ? 0 : this.hits / reads,
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      sizeWatermark: this.sizeWatermark,
    });
  }

  /** Zero the observation window; the watermark restarts from current size. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.expired = 0;
    this.evictions = 0;
    this.sizeWatermark = this.map.size;
  }
}
