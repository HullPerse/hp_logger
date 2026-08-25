import { LruCache } from "./lru.utils";

/**
 * Bounded duplicate counter over keyed entries: the first entry starts a
 * group, further hits only bump its `count`. Pure bookkeeping - what a group
 * carries, how summaries render, and when they flush stay with the caller
 * (RepeatTransport uses window timers, AdaptiveTransport drains on recovery).
 */
export class GroupCounter<K, V extends { count: number }> {
  private readonly groups: LruCache<K, V>;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.groups = new LruCache(maxSize, onEvict);
  }

  get size(): number {
    return this.groups.size;
  }

  /** Bump the count of an existing group. True means the entry was absorbed. */
  absorb(key: K): boolean {
    const group = this.groups.get(key);
    if (group === undefined) return false;
    group.count += 1;
    return true;
  }

  /** Start a new group with count 1. */
  start(key: K, value: V): void {
    this.groups.set(key, value);
  }

  /** Remove and return one group (window timers and targeted flushes). */
  take(key: K): V | undefined {
    const group = this.groups.peek(key);
    if (group !== undefined) this.groups.delete(key);
    return group;
  }

  /**
   * Visit every group oldest-first and empty the counter. Safe against
   * deletion inside `visit`: the key list is snapshotted before iterating.
   */
  drain(visit: (value: V) => void): void {
    for (const key of this.groups.keys()) {
      const group = this.groups.peek(key);
      this.groups.delete(key);
      if (group !== undefined) visit(group);
    }
  }
}
