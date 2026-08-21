import type { FileSettings, LogEntry, Transport } from '../types';

export class FileTransport implements Transport {
  private buffer: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly file: ReturnType<typeof Bun.file>;
  private readonly filepath: string;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  constructor(filepath: string, options: Omit<FileSettings, 'enabled'>) {
    this.filepath = filepath;
    this.file = Bun.file(filepath);
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.startFlushInterval();
  }

  write(entry: LogEntry): void {
    this.buffer.push(JSON.stringify(entry));
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const data = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    // @ts-expect-error - Bun.write accepts BunFile with append option
    Bun.write(this.file, data, { append: true, create: true });
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushInterval.unref();
  }

  close(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}
