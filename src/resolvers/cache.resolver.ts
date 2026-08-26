/** Bounded TTL store: keys live at most ttlMs and the oldest fall out on overflow. */
export class ResolverCache {
  private readonly map = new Map<string, { expiresAt: number; fields: Record<string, unknown> }>();
  private readonly max: number;

  constructor(max = 8192) {
    this.max = max;
  }

  get(key: string, now: number): Record<string, unknown> | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    if (hit.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    // Bump recency: hot keys survive eviction longer.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.fields;
  }

  set(key: string, fields: Record<string, unknown>, ttlMs: number, now: number): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { expiresAt: now + ttlMs, fields });
  }
}
