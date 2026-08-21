import { appendFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { ContextFormat, FileSettings, LogEntry, Transport } from '../types';
import { formatEntry } from '../utils';

// One file per day shared by all transport instances with the same baseDir.
// Without this every logger (SYSTEM, HTTP, ...) would open its own file and
// each flush could jump to the next index - production needs one file per day.
const sharedFilepaths = new Map<string, string>();

export class DateBasedFileTransport implements Transport {
  private buffer: string[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private currentFilepath: string | null = null;
  private readonly baseDir: string;
  private readonly flushIntervalMs: number;
  private readonly contextFormat: ContextFormat;
  private readonly maxBufferSize: number;
  private readonly maxFilesPerDay: number;
  private readonly mode: 'json' | 'pretty';

  constructor(
    baseDir: string,
    options: Omit<FileSettings, 'enabled'> & { contextFormat?: ContextFormat }
  ) {
    this.baseDir = baseDir;
    this.contextFormat = options.contextFormat ?? 'json';
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.maxFilesPerDay = options.maxFilesPerDay ?? 100;
    this.mode = options.mode ?? 'json';
    this.startFlushInterval();
  }

  private getDateDir(): string {
    const [dateStr] = new Date().toISOString().split('T');
    return path.join(this.baseDir, dateStr);
  }

  private async getNextFilepath(dateDir: string): Promise<string> {
    await mkdir(dateDir, { recursive: true });

    const files = await readdir(dateDir);
    const indices = files
      .filter((f) => f.startsWith('log_') && f.endsWith('.log'))
      .map((f) => Math.trunc(Number(f.slice(4, -4))))
      .filter((n) => !Number.isNaN(n));

    let nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

    if (nextIndex > this.maxFilesPerDay) {
      nextIndex = 1;
    }

    return path.join(dateDir, `log_${String(nextIndex).padStart(3, '0')}.log`);
  }

  private async ensureFile(): Promise<void> {
    const dateDir = this.getDateDir();
    const key = `${this.baseDir}::${dateDir}`;

    let filepath = sharedFilepaths.get(key);
    if (!filepath) {
      filepath = await this.getNextFilepath(dateDir);
      sharedFilepaths.set(key, filepath);
    }

    if (filepath !== this.currentFilepath) {
      this.currentFilepath = filepath;
    }
  }

  write(entry: LogEntry): void {
    this.buffer.push(formatEntry(entry, this.mode, this.contextFormat));
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await this.ensureFile();
    const data = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    const filepath = this.currentFilepath;
    if (filepath) {
      await appendFile(filepath, data);
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
  }
}
