import type { FileSettings, LogEntry, Transport } from '../types';
import { formatEntry } from '../utils';

export class FileTransport implements Transport {
  private buffer: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly file: ReturnType<typeof Bun.file>;
  private readonly filepath: string;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly mode: 'json' | 'pretty';

  constructor(filepath: string, options: Omit<FileSettings, 'enabled'>) {
    this.filepath = filepath;
    this.file = Bun.file(filepath);
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.mode = options.mode ?? 'json';
    this.startFlushInterval();
  }

  write(entry: LogEntry): void {
    this.buffer.push(formatEntry(entry, this.mode));
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const data = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    // @ts-expect-error - Bun.write accepts BunFile with append option
    await Bun.write(this.file, data, { append: true, create: true });
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
  }
}
