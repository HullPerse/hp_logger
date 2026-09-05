import { applyJitter } from "../lib/retry.utils.js";
import { reportTransportError, startUnrefTimeout } from "../lib/transport.utils.js";
import type { LogEntry, LoggerSettings } from "../types/logger.js";
import type { Transport, TransportStats } from "../types/transport.js";

type WorkerInbound =
  | { type: "init"; settings: LoggerSettings }
  | { type: "entry"; entry: LogEntry }
  | { type: "flush"; id: number }
  | { type: "close"; id: number };

type WorkerOutbound =
  | { type: "ready" }
  | { type: "acked"; id: number }
  | { type: "stats"; id: number; stats: TransportStats };

const MAX_RESTART_DELAY_MS = 30_000;
const RESTART_JITTER = 0.2;

/** Exponential restart delay for the Nth crash (1-based), capped at 30s. */
export const nextRestartDelayMs = (attempt: number): number =>
  Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_RESTART_DELAY_MS);

/**
 * Runs every configured transport inside a Worker thread: JSON
 * serialization, file writes and database batches leave the main thread
 * entirely. `settings` must be JSON-safe (no RegExp `redactKeys`, no
 * function `format`/`serializers`/`filters` - use `redactPaths` and
 * templates instead). The worker resolves its own settings, so the main
 * thread ships plain data only.
 *
 * A crashed or exited worker is rebuilt automatically: the next write pays
 * an exponential backoff wait (capped at 30s, +-20% jitter) and spawns a
 * fresh thread. Entries posted while the worker was down are lost - pair
 * the transport with the black box when that matters.
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
  private spawn: Promise<void> | null = null;
  private restarting: Promise<null> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;

  constructor(settings: LoggerSettings) {
    this.settings = settings;
  }

  private async ensureWorker(): Promise<void> {
    if (this.closed) return;
    if (this.restarting) await this.restarting;
    if (this.worker && this.ready) {
      await this.ready;
      return;
    }
    this.spawn ??= this.spawnWorker();
    try {
      await this.spawn;
    } finally {
      this.spawn = null;
    }
  }

  private async spawnWorker(): Promise<void> {
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
    let settled = false;
    worker.addEventListener("message", (event: MessageEvent<WorkerOutbound>): void => {
      const { data } = event;
      if (data.type === "ready") {
        settled = true;
        this.restartAttempts = 0;
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
      settled = true;
      this.onWorkerCrash(event.message);
    });
    worker.addEventListener("exit", (): void => {
      if (!this.closed && !settled) this.onWorkerCrash("worker exited unexpectedly");
    });
    const init: WorkerInbound = { settings: this.settings, type: "init" };
    postToWorker(worker, init);
    this.ready = ready;
    await this.ready;
  }

  /**
   * Rebuild path for a crashed worker: drop the dead handle, wait out an
   * exponentially growing delay, and let the next write respawn. Idempotent
   * per outage; a successful ready resets the attempt counter.
   */
  private onWorkerCrash(reason: string): void {
    if (this.closed || this.restarting !== null) return;
    this.worker = null;
    this.ready = null;
    this.restartAttempts += 1;
    const wait = applyJitter(nextRestartDelayMs(this.restartAttempts), RESTART_JITTER);
    reportTransportError("worker crashed", `(${reason}) - restarting in ${Math.round(wait)}ms`);
    const gate = Promise.withResolvers<null>();
    this.restarting = gate.promise;
    this.restartTimer = startUnrefTimeout((): void => {
      this.restartTimer = null;
      this.restarting = null;
      gate.resolve(null);
      const respawn = async (): Promise<void> => {
        try {
          await this.ensureWorker();
        } catch (error) {
          // Spawn failures route back through the crash path, which reschedules.
          this.onWorkerCrash(error instanceof Error ? error.message : String(error));
        }
      };
      respawn();
    }, wait);
  }

  async write(entry: Parameters<Transport["write"]>[0]): Promise<void> {
    if (this.closed) return;
    await this.ensureWorker();
    // ensureWorker may have rebuilt the thread; a lost race here drops the
    // entry silently, matching the crash-restart contract above.
    if (this.worker) {
      const message: WorkerInbound = { entry, type: "entry" };
      postToWorker(this.worker, message);
    }
  }

  /** Post a flush/close round trip and wait for the worker acknowledgement. */
  private async sendAndWait(type: "flush" | "close"): Promise<void> {
    const { worker } = this;
    if (worker === null) return;
    this.seq += 1;
    const id = this.seq;
    const { promise, resolve } = Promise.withResolvers<null>();
    this.acks.set(id, resolve);
    const message: WorkerInbound = { id, type };
    postToWorker(worker, message);
    await promise;
  }

  /** Flush the worker-side transports and wait for the acknowledgement. */
  async flush(): Promise<void> {
    if (this.closed || this.worker === null) return;
    await this.sendAndWait("flush");
  }

  /** Flush, close the worker-side transports, then terminate the thread. */
  async close(): Promise<void> {
    if (this.closed || this.worker === null) return;
    this.closed = true;
    await this.sendAndWait("close");
    this.worker.terminate();
    this.worker = null;
  }
}

/** Create a transport that offloads the configured stack to a Worker thread. */
export const createThreadTransport = (settings: LoggerSettings): ThreadTransport =>
  new ThreadTransport(settings);
