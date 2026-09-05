import { startUnrefInterval, stopInterval } from "../lib/transport.utils.js";

import { DEFAULT_FLUSH_INTERVAL } from "../config/writer.config.js";
import type { LogLevel } from "../types/logger.js";

/** Lines per channel held before an early buffered flush. */
const LINE_CAP = 64;

let exitHookInstalled = false;
const activeBuffers = new Set<BufferedConsole>();

const installExitHook = (): void => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const buffer of activeBuffers) buffer.flush();
  });
};

const registerBuffer = (buffer: BufferedConsole): void => {
  activeBuffers.add(buffer);
  installExitHook();
};

const unregisterBuffer = (buffer: BufferedConsole): void => {
  activeBuffers.delete(buffer);
};

/**
 * Coalesces rendered console lines into two stdio channels and flushes
 * them as one write per interval, cap, or explicit flush. Order is kept
 * per channel; the log/debug method split collapses inside a chunk.
 */
export class BufferedConsole {
  private outLines: string[] = [];
  private errLines: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly onFlush: (out: string | null, err: string | null) => void;

  constructor(onFlush: (out: string | null, err: string | null) => void) {
    this.onFlush = onFlush;
    registerBuffer(this);
    this.timer = startUnrefInterval(() => this.flush(), DEFAULT_FLUSH_INTERVAL);
  }

  push(level: LogLevel, line: string): void {
    const channel = level === "error" || level === "fatal" || level === "warn" ? this.errLines : this.outLines;
    channel.push(line);
    if (channel.length >= LINE_CAP) this.flush();
  }

  flush(): void {
    const out = this.outLines;
    const err = this.errLines;
    if (out.length === 0 && err.length === 0) return;
    let outChunk: string | null = null;
    let errChunk: string | null = null;
    if (out.length > 0) {
      outChunk = out.join("\n");
      out.length = 0;
    }
    if (err.length > 0) {
      errChunk = err.join("\n");
      err.length = 0;
    }
    this.onFlush(outChunk, errChunk);
  }

  close(): void {
    stopInterval(this.timer);
    this.timer = null;
    unregisterBuffer(this);
    this.flush();
  }
}
