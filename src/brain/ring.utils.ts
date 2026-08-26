/** Immutable counters for one ring buffer instance. */
export interface RingBufferStats {
  capacity: number;
  size: number;
  pushed: number;
  /** Oldest values displaced by pushes onto a full buffer. */
  overwritten: number;
  clears: number;
  /** Largest observed size since creation or the last resetStats(). */
  sizeWatermark: number;
}

/** Fixed-capacity circular buffer: the oldest value is dropped when full. */
export class RingBuffer<T> {
  private readonly buffer: T[];
  private readonly capacity: number;
  private head = 0;
  private count = 0;
  private pushed = 0;
  private overwritten = 0;
  private clears = 0;
  private sizeWatermark = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.buffer = Array.from({ length: this.capacity });
  }

  get size(): number {
    return this.count;
  }

  push(value: T): void {
    this.pushed += 1;
    this.buffer[(this.head + this.count) % this.capacity] = value;
    if (this.count < this.capacity) {
      this.count += 1;
      if (this.count > this.sizeWatermark) this.sizeWatermark = this.count;
    } else {
      // Buffer is full: the new value overwrites the oldest slot by advancing
      // the head, so the buffer holds the most recent `capacity` values.
      this.head = (this.head + 1) % this.capacity;
      this.overwritten += 1;
    }
  }

  /** All values in insertion order (oldest first). */
  toArray(): T[] {
    const result: T[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      result.push(this.buffer[(this.head + offset) % this.capacity] as T);
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.clears += 1;
  }

  /** Frozen point-in-time counters for diagnostics and sizing decisions. */
  stats(): RingBufferStats {
    return Object.freeze({
      capacity: this.capacity,
      clears: this.clears,
      overwritten: this.overwritten,
      pushed: this.pushed,
      size: this.count,
      sizeWatermark: this.sizeWatermark,
    });
  }

  /** Zero the observation window; the watermark restarts from current size. */
  resetStats(): void {
    this.pushed = 0;
    this.overwritten = 0;
    this.clears = 0;
    this.sizeWatermark = this.count;
  }
}
