/** Fixed-capacity circular buffer: the oldest value is dropped when full. */
export class RingBuffer<T> {
  private readonly buffer: T[];
  private readonly capacity: number;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.buffer = Array.from({ length: this.capacity });
  }

  get size(): number {
    return this.count;
  }

  push(value: T): void {
    this.buffer[(this.head + this.count) % this.capacity] = value;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      // Buffer is full: the new value overwrites the oldest slot by advancing
      // the head, so the buffer holds the most recent `capacity` values.
      this.head = (this.head + 1) % this.capacity;
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
  }
}
