import type { DatabaseAdapter, DatabaseSettings, LogEntry, LogLevel, Transport } from '../types';
import { LOG_LEVELS } from '../types';

export class DatabaseTransport implements Transport {
  private buffer: LogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly adapter: DatabaseAdapter;
  private readonly flushIntervalMs: number;
  private readonly level: LogLevel;
  private readonly maxBufferSize: number;

  constructor(settings: DatabaseSettings) {
    if (!settings.adapter) {
      throw new Error('DatabaseTransport requires an adapter when enabled');
    }
    this.adapter = settings.adapter;
    this.flushIntervalMs = settings.flushIntervalMs ?? 1000;
    this.level = settings.level ?? 'debug';
    this.maxBufferSize = settings.maxBufferSize ?? 100;
    this.startFlushInterval();
  }

  write(entry: LogEntry): void {
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.level]) return;
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) this.write(entry);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.adapter.write(batch);
    } catch {
      // Adapter errors are non-fatal for logging
    }
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
    this.flushInterval.unref();
  }

  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    await this.adapter.close?.();
  }
}
