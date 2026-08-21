import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

import type { ContextFormat, FileSettings, LogEntry, Transport } from '../types';
import { formatEntry } from '../utils';

export class FileTransport implements Transport {
  private buffer: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly filepath: string;
  private readonly flushIntervalMs: number;
  private readonly contextFormat: ContextFormat;
  private readonly maxBufferSize: number;
  private readonly mode: 'json' | 'pretty';
  private stream: WriteStream | null = null;

  constructor(
    filepath: string,
    options: Omit<FileSettings, 'enabled'> & { contextFormat?: ContextFormat }
  ) {
    this.filepath = filepath;
    this.contextFormat = options.contextFormat ?? 'json';
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.mode = options.mode ?? 'json';
    this.startFlushInterval();
  }

  write(entry: LogEntry): void {
    this.pushEntries([entry]);
  }

  writeBatch(entries: LogEntry[]): void {
    this.pushEntries(entries);
  }

  private pushEntries(entries: LogEntry[]): void {
    for (const entry of entries) {
      this.buffer.push(formatEntry(entry, this.mode, this.contextFormat));
    }
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!this.stream) {
      // Keep the file open between flushes instead of reopening per flush.
      this.stream = createWriteStream(this.filepath, { flags: 'a' });
    }
    const data = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    const { stream } = this;
    if (!stream.write(data)) {
      await once(stream, 'drain');
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
    const { stream } = this;
    if (stream) {
      stream.end();
      await finished(stream);
      this.stream = null;
    }
  }
}
