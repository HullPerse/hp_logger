import type { LogEntry, Transport } from '../types';

interface QueuedEntry {
  entry: LogEntry;
  resolve: () => void;
}

export class AsyncTransport implements Transport {
  private readonly batchSize: number;
  private readonly flushInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private readonly queue: QueuedEntry[] = [];
  private readonly transport: Transport;

  constructor(transport: Transport, options: { batchSize?: number; flushIntervalMs?: number } = {}) {
    this.transport = transport;
    this.batchSize = options.batchSize ?? 50;
    if (options.flushIntervalMs) {
      this.flushInterval = setInterval(() => this.flush(), options.flushIntervalMs);
      this.flushInterval.unref();
    }
  }

  write(entry: LogEntry): Promise<void> {
    const { promise, resolve } = Promise.withResolvers();
    this.queue.push({ entry, resolve });
    if (this.queue.length >= this.batchSize) {
      this.flush();
    } else if (!this.processing) {
      this.scheduleFlush();
    }
    return promise as Promise<void>;
  }

  private scheduleFlush(): void {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    queueMicrotask(() => this.flush());
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    const entries = batch.map(({ entry }) => entry);
    const resolveAll = () => {
      for (const { resolve } of batch) resolve();
    };

    try {
      if (this.transport.writeBatch) {
        await this.transport.writeBatch(entries);
      } else {
        // Single await for the whole batch instead of one promise per entry.
        const promises = entries.map((entry) => Promise.resolve(this.transport.write(entry)));
        await Promise.all(promises);
      }
    } catch {
      // Transport errors are non-fatal for logging
    }
    resolveAll();

    this.processing = false;
    if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  async close(): Promise<void> {
    if (this.queue.length > 0) {
      const batch = this.queue.splice(0);
      const entries = batch.map(({ entry }) => entry);
      try {
        if (this.transport.writeBatch) {
          await this.transport.writeBatch(entries);
        } else {
          const promises = entries.map((entry) => Promise.resolve(this.transport.write(entry)));
          await Promise.all(promises);
        }
      } catch {
        // Transport errors are non-fatal for logging
      }
      for (const { resolve } of batch) resolve();
    }
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.transport.close?.();
  }
}
