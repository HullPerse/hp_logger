import { DEFAULT_BATCH_SIZE, DEFAULT_MAX_QUEUE_SIZE } from "../config/writer.config";
import { attemptAsync } from "../lib/result.utils";
import { dispatchBatch, startUnrefInterval, stopInterval } from "../lib/transport.utils";
import type { BatchingSettings, LogEntry, LogLevel } from "../types/logger";
import type { QueuedEntry, Transport, TransportStats } from "../types/transport";

export class AsyncTransport implements Transport {
  private readonly batchSize: number;
  private readonly flushOn: LogLevel[];
  private readonly maxQueueSize: number;
  private readonly flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private scheduled = false;
  private closing: Promise<void> | null = null;
  private closed = false;
  private pending = 0;
  private dropped = 0;
  private transportErrors = 0;
  private readonly queue: QueuedEntry[] = [];
  private readonly transport: Transport;

  constructor(transport: Transport, options: BatchingSettings = {}) {
    this.transport = transport;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.flushOn = options.flushOn ?? [];
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
    if (options.flushInterval) {
      this.flushTimer = startUnrefInterval(() => {
        this.flush();
      }, options.flushInterval);
    }
  }

  write(entry: LogEntry): Promise<void> {
    const deferred = Promise.withResolvers<null>();
    const resolve = (): void => {
      deferred.resolve(null);
    };
    if (this.closed || this.pending >= this.maxQueueSize) {
      this.dropped += 1;
      resolve();
      return deferred.promise as unknown as Promise<void>;
    }

    this.pending += 1;
    this.queue.push({ entry, resolve });
    if (this.queue.length >= this.batchSize || this.flushOn.includes(entry.level)) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
    return deferred.promise as unknown as Promise<void>;
  }

  private scheduleFlush(): void {
    if (this.flushPromise || this.scheduled || this.queue.length === 0) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /** Deliver the pending queue without closing; the transport stays usable. */
  async flush(): Promise<void> {
    for (;;) {
      if (this.flushPromise === null && this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        const entries = batch.map(({ entry }) => entry);
        this.flushPromise = this.runFlush(batch, entries);
      }
      if (this.flushPromise === null) return;
      await this.flushPromise;
    }
  }

  private async runFlush(batch: QueuedEntry[], entries: LogEntry[]): Promise<void> {
    await this.drain(entries);
    this.pending -= batch.length;
    for (const { resolve } of batch) resolve();
    this.flushPromise = null;
    if (this.queue.length > 0) this.scheduleFlush();
  }

  /** Send a batch to the wrapped transport; failures are counted and non-fatal. */
  private async drain(entries: LogEntry[]): Promise<void> {
    const outcome = await attemptAsync(() => dispatchBatch(this.transport, entries));
    if (!outcome.ok) this.transportErrors += 1;
  }

  stats(): TransportStats {
    const nested = this.transport.stats?.();
    return {
      dropped: this.dropped + (nested?.dropped ?? 0),
      queued: this.pending + (nested?.queued ?? 0),
      transportErrors: this.transportErrors + (nested?.transportErrors ?? 0),
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
    this.scheduled = false;
    await this.waitForFlushes();
    await this.transport.close?.();
  }

  private async waitForFlushes(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      return this.waitForFlushes();
    }
    if (this.queue.length > 0) {
      this.flush();
      return this.waitForFlushes();
    }
  }
}
