import { LruCache } from "./lru.utils.js";

/** Immutable counters for one group counter instance. */
export interface GroupCounterStats {
  size: number;
  /** Duplicates merged into existing groups. */
  absorbed: number;
  /** New groups created. */
  started: number;
  taken: number;
  /** Groups handed to the drain visitor. */
  drained: number;
  /** Groups dropped by cache pressure before their window closed. */
  evicted: number;
  /** absorbed / (absorbed + started); dedupe effectiveness of the caller. */
  absorbRatio: number;
}

/**
 * Bounded duplicate counter over keyed entries: the first entry starts a
 * group, further hits only bump its `count`. Pure bookkeeping - what a group
 * carries, how summaries render, and when they flush stay with the caller
 * (RepeatTransport uses window timers, AdaptiveTransport drains on recovery).
 */
export class GroupCounter<K, V extends { count: number }> {
  private readonly groups: LruCache<K, V>;
  private absorbed = 0;
  private started = 0;
  private taken = 0;
  private drained = 0;
  private evicted = 0;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.groups = new LruCache(maxSize, (key, value) => {
      this.evicted += 1;
      onEvict?.(key, value);
    });
  }

  get size(): number {
    return this.groups.size;
  }

  /** Bump the count of an existing group. True means the entry was absorbed. */
  absorb(key: K): boolean {
    const group = this.groups.get(key);
    if (group === undefined) return false;
    this.absorbed += 1;
    group.count += 1;
    return true;
  }

  /** Start a new group with count 1. */
  start(key: K, value: V): void {
    this.started += 1;
    this.groups.set(key, value);
  }

  /** Remove and return one group (window timers and targeted flushes). */
  take(key: K): V | undefined {
    const group = this.groups.peek(key);
    if (group !== undefined) {
      this.taken += 1;
      this.groups.delete(key);
    }
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
      if (group !== undefined) {
        this.drained += 1;
        visit(group);
      }
    }
  }

  /** Frozen point-in-time counters for diagnostics and sizing decisions. */
  stats(): GroupCounterStats {
    const created = this.absorbed + this.started;
    return Object.freeze({
      absorbRatio: created === 0 ? 0 : this.absorbed / created,
      absorbed: this.absorbed,
      drained: this.drained,
      evicted: this.evicted,
      size: this.groups.size,
      started: this.started,
      taken: this.taken,
    });
  }

  /** Zero the observation window. */
  resetStats(): void {
    this.absorbed = 0;
    this.started = 0;
    this.taken = 0;
    this.drained = 0;
    this.evicted = 0;
  }
}
