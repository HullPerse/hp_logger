import { createWriteStream, fsync } from "node:fs";
import type { WriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";

import { DEFAULT_FLUSH_INTERVAL, DEFAULT_MAX_BUFFER_SIZE } from "../config/writer.config";
import { formatEntry } from "../format/entry.format";
import { attemptAsync } from "../lib/result.utils";
import { startUnrefInterval, stopInterval } from "../lib/transport.utils";
import type {
  ContextFormat,
  EntryFormatter,
  FormatSettings,
  LogEntry,
  TagCase,
} from "../types/logger";
import type { FileTransportOptions, Transport, TransportStats } from "../types/transport";

/** Common buffered file writing shared by fixed-path and daily-rotating transports. */
export abstract class BaseFileTransport implements Transport {
  protected buffer: string[] = [];
  protected readonly contextFormat: ContextFormat;
  protected readonly flushInterval: number;
  protected readonly format: EntryFormatter | FormatSettings | undefined;
  protected readonly fsyncOnClose: boolean;
  protected readonly maxBufferSize: number;
  protected readonly mode: "json" | "pretty";
  protected readonly stripControl: boolean;
  protected readonly tagCase: TagCase;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stream: WriteStream | null = null;
  // Bound with the stream it belongs to, so pushEntries' flush path pays
  // no per-flush promisify/bind work.
  private writeChunk: ((chunk: string) => Promise<void>) | null = null;
  private transportErrors = 0;
  private flushPromise: Promise<void> | null = null;
  // Bound once so pushEntries pays one call argument instead of six.
  private readonly renderLine: (entry: LogEntry) => string;

  constructor(options: Omit<FileTransportOptions, "path">) {
    this.contextFormat = options.contextFormat ?? "json";
    this.format = options.format;
    this.fsyncOnClose = options.fsync === true;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.mode = options.mode ?? "json";
    this.stripControl = options.stripControl ?? false;
    this.tagCase = options.tagCase ?? "upper";
    this.renderLine = (entry) =>
      formatEntry(
        entry,
        this.mode,
        this.contextFormat,
        this.format,
        this.tagCase,
        this.stripControl,
      );
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
      this.buffer.push(this.renderLine(entry));
    }
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /** Write buffered lines to the target file; safe to call directly. */
  async flush(): Promise<void> {
    if (this.flushPromise !== null) return this.flushPromise;
    const run = async (): Promise<void> => {
      if (this.buffer.length === 0) return;
      const filepath = await this.targetFilepath();
      if (!filepath) return;
      if (this.stream === null) {
        const created = createWriteStream(filepath, { flags: "a" });
        // Without a listener a stream error becomes an uncaughtException.
        // Self-healing: destroy the dead stream so the next flush re-opens
        // it fresh (deleted file, bad path, full disk).
        created.on("error", () => {
          created.destroy();
          if (this.stream === created) {
            this.stream = null;
            this.writeChunk = null;
          }
        });
        this.stream = created;
        this.writeChunk = promisify(created.write.bind(created)) as (chunk: string) => Promise<void>;
      }
      const { stream, writeChunk } = this;
      if (writeChunk === null) return;
      const data = `${this.buffer.join("\n")}\n`;
      this.buffer = [];
      // The write callback fires after the chunk reaches the file descriptor,
      // so callers (size rotation) can stat the file right after the flush.
      const outcome = await attemptAsync(() => writeChunk(data));
      // File write errors are non-fatal for logging; the buffer is already
      // cleared. The stream is destroyed and re-created on the next flush:
      // a broken stream (deleted file, full disk, revoked handle) stays
      // broken forever otherwise.
      if (!outcome.ok) {
        this.transportErrors += 1;
        console.error(`hp_logger: file flush failed: ${outcome.error.message}`);
        stream.destroy();
        if (this.stream === stream) this.stream = null;
      }
    };
    this.flushPromise = run();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
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
      this.writeChunk = null;
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
    // Strict durability: push the fd's dirty pages to the disk before the
    // stream closes. Best-effort - a failing fsync warns but still closes.
    if (this.fsyncOnClose && this.stream !== null) {
      const { fd } = this.stream;
      if (typeof fd === "number") {
        const outcome = await attemptAsync(() => promisify(fsync)(fd));
        if (!outcome.ok) {
          console.error(`hp_logger: fsync failed: ${outcome.error.message}`);
        }
      }
    }
    await this.closeStream();
  }
}
