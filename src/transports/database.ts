import type { DatabaseAdapter, DatabaseSettings, LogEntry, LogLevel, Transport } from '../types';
import { LOG_LEVELS } from '../types';

/**
 * Buffers entries and hands them to the adapter in strict FIFO order,
 * one batch in flight at a time. Adapter failures keep the batch at the
 * head of the queue; the next trigger (full buffer, interval tick or
 * close) retries it. close() drains everything but never hangs on a
 * persistently failing adapter.
 */
export class DatabaseTransport implements Transport {
  private buffer: LogEntry[] = [];
  private readonly adapter: DatabaseAdapter;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly level: LogLevel;
  private closed = false;
  private closeRetryUsed = false;
  private closing: Promise<void> | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private idleWaiters: (() => void)[] = [];
  private inflight = 0;

  constructor(settings: DatabaseSettings) {
    if (!settings.adapter) {
      throw new Error('DatabaseTransport requires an adapter when enabled');
    }
    this.adapter = settings.adapter;
    this.flushIntervalMs = settings.flushIntervalMs ?? 1000;
    this.level = settings.level ?? 'debug';
    this.batchSize = Math.max(1, settings.maxBufferSize ?? 100);
    this.flushInterval = setInterval(() => {
      this.pump();
    }, this.flushIntervalMs);
    this.flushInterval.unref();
  }

  write(entry: LogEntry): void {
    if (this.closed || LOG_LEVELS[entry.level] < LOG_LEVELS[this.level]) return;
    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) this.pump();
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) this.write(entry);
  }

  /** Take up to batchSize entries from the head of the queue. */
  private takeBatch(): LogEntry[] {
    return this.buffer.splice(0, this.batchSize);
  }

  /**
   * Start writing the next batch when no write is in flight. Called from
   * every trigger; concurrent callers collapse into the single in-flight
   * write, which preserves FIFO order.
   */
  private pump(): void {
    if (this.inflight > 0) return;
    const batch = this.takeBatch();
    if (batch.length === 0) {
      this.notifyIdle();
      return;
    }
    this.inflight += 1;
    this.writeNext(batch);
  }

  /** Write one batch, then continue draining. Never rejects. */
  private async writeNext(batch: LogEntry[]): Promise<void> {
    let failed = false;
    try {
      await this.adapter.write(batch);
    } catch {
      this.buffer.unshift(...batch);
      failed = true;
    } finally {
      this.inflight -= 1;
    }
    if (failed) {
      // During close, give the queue one full retry pass before giving up,
      // so a failure right before or during shutdown still gets a second
      // attempt instead of dropping everything silently.
      if (this.closed && !this.closeRetryUsed) {
        this.closeRetryUsed = true;
        queueMicrotask(() => this.pump());
        return;
      }
      this.notifyIdle();
      return;
    }
    this.pump();
  }

  /** Resolve close() waiters once nothing is in flight and nothing is writable. */
  private notifyIdle(): void {
    if (this.inflight > 0 || (this.buffer.length > 0 && !this.closed)) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.closeRetryUsed = false;
    const drained = Promise.withResolvers<null>();
    this.idleWaiters.push(() => {
      drained.resolve(null);
    });
    this.pump();
    await drained.promise;
    await this.adapter.close?.();
  }
}
