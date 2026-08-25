import type { LogEntry, LoggerSettings } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";

type WorkerInbound =
  | { type: "init"; settings: LoggerSettings }
  | { type: "entry"; entry: LogEntry }
  | { type: "flush"; id: number }
  | { type: "close"; id: number };

type WorkerOutbound =
  | { type: "ready" }
  | { type: "acked"; id: number }
  | { type: "stats"; id: number; stats: TransportStats };

/**
 * Runs every configured transport inside a Worker thread: JSON
 * serialization, file writes and database batches leave the main thread
 * entirely. `settings` must be JSON-safe (no RegExp `redactKeys`, no
 * function `format`/`serializers`/`filters` - use `redactPaths` and
 * templates instead). The worker resolves its own settings, so the main
 * thread ships plain data only.
 */
/** Bun workers take postMessage(data) - no targetOrigin, unlike the DOM API. */
const postToWorker = (worker: Worker, message: WorkerInbound): void => {
  const send = worker.postMessage.bind(worker) as (message: WorkerInbound) => void;
  send(message);
};

export class ThreadTransport implements Transport {
  private worker: Worker | null = null;
  private readonly settings: LoggerSettings;
  private readonly acks = new Map<number, () => void>();
  private seq = 0;
  private ready: Promise<true> | null = null;
  private closed = false;

  constructor(settings: LoggerSettings) {
    this.settings = settings;
  }

  private async ensureWorker(): Promise<void> {
    if (this.ready !== null) await this.ready;
    // Tests run from src (TypeScript), the published package from dist (JS).
    const sibling = import.meta.url.endsWith(".ts")
      ? "./worker.transport.ts"
      : "./worker.transport.js";
    const url = new URL(sibling, import.meta.url);
    const worker = new Worker(url);
    this.worker = worker;
    const {
      promise: ready,
      reject: rejectReady,
      resolve: resolveReady,
    } = Promise.withResolvers<true>();
    worker.addEventListener("message", (event: MessageEvent<WorkerOutbound>): void => {
      const { data } = event;
      if (data.type === "ready") {
        resolveReady(true);
        return;
      }
      if (data.type === "acked") {
        const resolve = this.acks.get(data.id);
        if (resolve !== undefined) {
          this.acks.delete(data.id);
          resolve();
        }
      }
    });
    worker.addEventListener("error", (event: ErrorEvent): void => {
      rejectReady(new Error(`hp_logger worker failed: ${event.message}`));
    });
    const init: WorkerInbound = { settings: this.settings, type: "init" };
    postToWorker(worker, init);
    this.ready = ready;
    await this.ready;
  }

  async write(entry: Parameters<Transport["write"]>[0]): Promise<void> {
    if (this.closed) return;
    await this.ensureWorker();
    const message: WorkerInbound = { entry, type: "entry" };
    if (this.worker !== null) postToWorker(this.worker, message);
  }

  /** Flush the worker-side transports and wait for the acknowledgement. */
  async flush(): Promise<void> {
    if (this.closed || this.worker === null) return;
    this.seq += 1;
    const id = this.seq;
    const { promise: flushed, resolve } = Promise.withResolvers<null>();
    this.acks.set(id, resolve);
    const message: WorkerInbound = { id, type: "flush" };
    postToWorker(this.worker, message);
    await flushed;
  }

  /** Flush, close the worker-side transports, then terminate the thread. */
  async close(): Promise<void> {
    if (this.closed || this.worker === null) return;
    this.closed = true;
    this.seq += 1;
    const id = this.seq;
    const { promise: closed, resolve } = Promise.withResolvers<null>();
    this.acks.set(id, resolve);
    const message: WorkerInbound = { id, type: "close" };
    postToWorker(this.worker, message);
    await closed;
    this.worker.terminate();
    this.worker = null;
  }
}

/** Create a transport that offloads the configured stack to a Worker thread. */
export const createThreadTransport = (settings: LoggerSettings): ThreadTransport =>
  new ThreadTransport(settings);
