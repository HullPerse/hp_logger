import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

import type { ContextFormat, EntryFormatter, FileSettings, LogEntry, Transport } from '../types';
import { formatEntry } from '../utils';

/** Common buffered file writing shared by fixed-path and daily-rotating transports. */
export abstract class BaseFileTransport implements Transport {
  protected buffer: string[] = [];
  protected readonly contextFormat: ContextFormat;
  protected readonly flushIntervalMs: number;
  protected readonly format: EntryFormatter | undefined;
  protected readonly maxBufferSize: number;
  protected readonly mode: 'json' | 'pretty';
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private stream: WriteStream | null = null;

  constructor(options: Omit<FileSettings, 'enabled' | 'path'> & { contextFormat?: ContextFormat; format?: EntryFormatter }) {
    this.contextFormat = options.contextFormat ?? 'json';
    this.format = options.format;
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.mode = options.mode ?? 'json';
    this.startFlushInterval();
  }

  /** Path the next flush should write to; re-created when it changes. */
  protected abstract targetFilepath(): string | null | Promise<string | null>;

  write(entry: LogEntry): void {
    this.pushEntries([entry]);
  }

  writeBatch(entries: LogEntry[]): void {
    this.pushEntries(entries);
  }

  private pushEntries(entries: LogEntry[]): void {
    for (const entry of entries) {
      this.buffer.push(formatEntry(entry, this.mode, this.contextFormat, this.format));
    }
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  protected async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const filepath = await this.targetFilepath();
    if (!filepath) return;
    if (this.stream === null) {
      // Keep the file open between flushes instead of reopening per flush.
      this.stream = createWriteStream(filepath, { flags: 'a' });
    }
    const data = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    const { stream } = this;
    if (!stream.write(data)) {
      await once(stream, 'drain');
    }
  }

  protected async closeStream(): Promise<void> {
    const { stream } = this;
    if (stream) {
      stream.end();
      await finished(stream);
      this.stream = null;
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
    await this.closeStream();
  }
}
