/** Simple memoizer with a bounded result cache. */
export class Memoize<K, V> {
  private readonly cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = Math.max(1, maxSize);
    this.cache = new Map<K, V>();
  }

  /** Compute `fn(key)` once per key and return the cached result. */
  call(key: K, fn: () => V): V {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const value = fn();
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, value);
    return value;
  }

  clear(): void {
    this.cache.clear();
  }
}
