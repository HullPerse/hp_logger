/**
 * Bounded LRU cache. `Map` preserves insertion order, so `get` re-inserts
 * the key to mark it as most-recently-used and eviction drops the first
 * entry (the least-recently-used one).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = Math.max(1, maxSize);
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Bump to the end on access so it survives eviction longer.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next();
      if (!oldest.done) {
        const evicted = this.map.get(oldest.value);
        this.map.delete(oldest.value);
        this.onEvict?.(oldest.value, evicted as V);
      }
    }
    this.map.set(key, value);
  }

  /** Peek at a value without changing recency order. */
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
    this.map.clear();
  }
}