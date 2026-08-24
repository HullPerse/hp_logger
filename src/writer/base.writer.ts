import { once } from "node:events";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { finished } from "node:stream/promises";

import { DEFAULT_FLUSH_INTERVAL, DEFAULT_MAX_BUFFER_SIZE } from "../config/writer.config";
import { formatEntry } from "../format/entry.format";
import { attemptAsync } from "../lib/result.utils";
import { startUnrefInterval, stopInterval } from "../lib/transport.utils";
import type { ContextFormat, EntryFormatter, LogEntry, TagCase } from "../types/logger";
import type { FileTransportOptions, Transport, TransportStats } from "../types/transport";

/** Common buffered file writing shared by fixed-path and daily-rotating transports. */
export abstract class BaseFileTransport implements Transport {
  protected buffer: string[] = [];
  protected readonly contextFormat: ContextFormat;
  protected readonly flushInterval: number;
  protected readonly format: EntryFormatter | undefined;
  protected readonly maxBufferSize: number;
  protected readonly mode: "json" | "pretty";
  protected readonly stripControl: boolean;
  protected readonly tagCase: TagCase;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stream: WriteStream | null = null;
  private transportErrors = 0;

  constructor(
    options: Omit<FileTransportOptions, "path"> & {
      format?: EntryFormatter;
      stripControl?: boolean;
      tagCase?: TagCase;
    },
  ) {
    this.contextFormat = options.contextFormat ?? "json";
    this.format = options.format;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.mode = options.mode ?? "json";
    this.stripControl = options.stripControl ?? false;
    this.tagCase = options.tagCase ?? "upper";
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
      this.buffer.push(
        formatEntry(entry, this.mode, this.contextFormat, this.format, this.tagCase, this.stripControl),
      );
    }
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  protected async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const filepath = await this.targetFilepath();
    if (!filepath) return;
    if (this.stream === null) {
      // Keep the file open between flushes instead of reopening per flush.
      this.stream = createWriteStream(filepath, { flags: "a" });
    }
    const { stream } = this;
    const data = `${this.buffer.join("\n")}\n`;
    this.buffer = [];
    const outcome = await attemptAsync(async () => {
      if (!stream.write(data)) {
        await once(stream, "drain");
      }
    });
    // File write errors are non-fatal for logging; the buffer is already cleared.
    if (!outcome.ok) {
      this.transportErrors += 1;
      console.error(`hp_logger: file flush failed: ${outcome.error.message}`);
    }
  }

  stats(): TransportStats {
    return { dropped: 0, queued: this.buffer.length, transportErrors: this.transportErrors };
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
    this.flushTimer = startUnrefInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  async close(): Promise<void> {
    stopInterval(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
    await this.closeStream();
  }
}
