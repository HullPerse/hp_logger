import { LOG_LEVELS } from "../config/levels.config";
import { DEFAULT_FLUSH_INTERVAL, DEFAULT_MAX_BUFFER_SIZE } from "../config/writer.config";
import { attemptAsync } from "../lib/result.utils";
import { applyJitter, resolveRetry, retryDelayMs } from "../lib/retry.utils";
import type { ResolvedRetry } from "../lib/retry.utils";
import {
  startUnrefInterval,
  startUnrefTimeout,
  stopInterval,
  stopTimeout,
} from "../lib/transport.utils";
import type { LogEntry, LogLevel } from "../types/logger";
import type {
  DatabaseAdapter,
  DatabaseSettings,
  Transport,
  TransportStats,
} from "../types/transport";

/**
 * Buffers entries and hands them to the adapter in strict FIFO order,
 * one batch in flight at a time. Adapter failures keep the batch at the
 * head of the queue; without `retry` the next trigger (full buffer,
 * interval tick or close) retries it, with `retry` the batch waits for
 * an increasing backoff delay instead. close() drains everything but
 * never hangs on a persistently failing adapter.
 */
export class DatabaseTransport implements Transport {
  private buffer: LogEntry[] = [];
  private readonly adapter: DatabaseAdapter;
  private readonly batchSize: number;
  private dropped = 0;
  private readonly flushInterval: number;
  private readonly level: LogLevel;
  private closed = false;
  private closeRetryUsed = false;
  private closing: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private idleWaiters: (() => void)[] = [];
  private inflight = 0;
  private readonly retry: ResolvedRetry | null;
  private retryAttempt = 0;
  private retryDueAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private transportErrors = 0;

  constructor(settings: DatabaseSettings) {
    if (!settings.adapter) {
      throw new Error("DatabaseTransport requires an adapter when enabled");
    }
    this.adapter = settings.adapter;
    this.flushInterval = settings.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.level = settings.level ?? "debug";
    this.batchSize = Math.max(1, settings.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE);
    this.retry = resolveRetry(settings.retry);
    this.flushTimer = startUnrefInterval(() => {
      this.pump();
    }, this.flushInterval);
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
   * Start writing the next batch when no write is in flight and no retry
   * wait is due. Called from every trigger; concurrent callers collapse
   * into the single in-flight write, which preserves FIFO order.
   */
  private pump(): void {
    if (this.inflight > 0) return;
    if (this.buffer.length > 0 && Date.now() < this.retryDueAt) return;
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
    const outcome = await attemptAsync(() => this.adapter.write(batch));
    this.inflight -= 1;
    if (!outcome.ok) {
      this.transportErrors += 1;
      this.buffer.unshift(...batch);
      // During close, give the queue one full retry pass before giving up,
      // so a failure right before or during shutdown still gets a second
      // attempt instead of dropping everything silently.
      if (this.closed && !this.closeRetryUsed) {
        this.closeRetryUsed = true;
        queueMicrotask(() => this.pump());
        return;
      }
      if (!this.closed && this.retry !== null) {
        this.scheduleRetry();
      }
      this.notifyIdle();
      return;
    }
    this.resetRetry();
    this.pump();
  }

  /** Count the failed head batch and arm its next attempt, or drop it at the cap. */
  private scheduleRetry(): void {
    const { retry } = this;
    if (retry === null) return;
    this.retryAttempt += 1;
    if (this.retryAttempt >= retry.attempts) {
      this.dropped += this.takeBatch().length;
      this.resetRetry();
      return;
    }
    const waitMs = applyJitter(retryDelayMs(retry, this.retryAttempt), retry.jitter);
    this.retryDueAt = Date.now() + waitMs;
    stopTimeout(this.retryTimer);
    this.retryTimer = startUnrefTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, waitMs);
  }

  private resetRetry(): void {
    this.retryAttempt = 0;
    this.retryDueAt = 0;
    stopTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Resolve close() waiters once nothing is in flight and nothing is writable. */
  private notifyIdle(): void {
    if (this.inflight > 0 || (this.buffer.length > 0 && !this.closed)) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  stats(): TransportStats {
    return {
      dropped: this.dropped,
      queued: this.buffer.length + this.inflight,
      transportErrors: this.transportErrors,
    };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.finishClose();
    return this.closing;
  }

  private async finishClose(): Promise<void> {
    this.closed = true;
    stopInterval(this.flushTimer);
    this.flushTimer = null;
    // The final drain pass ignores any pending backoff wait.
    this.resetRetry();
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
