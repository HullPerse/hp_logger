import { LOG_LEVELS } from "../config/levels.config.js";
import { DEFAULT_FLUSH_INTERVAL, DEFAULT_MAX_BUFFER_SIZE } from "../config/writer.config.js";
import { attemptAsync } from "../lib/result.utils.js";
import { applyJitter, resolveRetry, retryDelayMs } from "../lib/retry.utils.js";
import type { ResolvedRetry } from "../lib/retry.utils.js";
import {
  startUnrefInterval,
  startUnrefTimeout,
  stopInterval,
  stopTimeout,
} from "../lib/transport.utils.js";
import type { LogContext, LogEntry, LogLevel } from "../types/logger.js";
import type {
  DatabaseAdapter,
  DatabaseSettings,
  Transport,
  TransportStats,
} from "../types/transport.js";

/** Author of retry/drop notices so they never re-enter this transport. */
const NOTICE_AUTHOR = "database";
/** Pending-entry cap while the adapter is being rebuilt. */
const RECOVERY_BACKLOG_CAP = 10_000;
const DEFAULT_RECONNECT_COOLDOWN_MS = 5000;
const DEFAULT_RECONNECT_ATTEMPTS = 3;

/**
 * Buffers entries and hands them to the adapter in strict FIFO order,
 * one batch in flight at a time. Adapter failures keep the batch at the
 * head of the queue; without `retry` the next trigger (full buffer,
 * interval tick or close) retries it, with `retry` the batch waits for
 * an increasing backoff delay instead. With `createAdapter` an exhausted
 * outage triggers an adapter rebuild (self-healing) instead of a drop.
 * close() drains everything but never hangs on a persistently failing
 * adapter.
 */
export class DatabaseTransport implements Transport {
  private buffer: LogEntry[] = [];
  private adapter: DatabaseAdapter;
  private readonly batchSize: number;
  private dropped = 0;
  private readonly flushInterval: number;
  private readonly level: LogLevel;
  private closed = false;
  private closeRetryUsed = false;
  private closing: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private idleWaiters: (() => void)[] = [];
  private inflight = 0;
  private readonly retry: ResolvedRetry | null;
  private readonly notices: Transport | null;
  private retryAttempt = 0;
  private retryDueAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private transportErrors = 0;
  private readonly createAdapter: (() => DatabaseAdapter | Promise<DatabaseAdapter>) | undefined;
  private readonly reconnectCooldownMs: number;
  private readonly reconnectMaxAttempts: number;
  private recovering = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: DatabaseSettings, notices?: Transport) {
    if (!settings.adapter) {
      throw new Error("DatabaseTransport requires an adapter when enabled");
    }
    this.adapter = settings.adapter;
    this.flushInterval = settings.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.level = settings.level ?? "debug";
    this.batchSize = Math.max(1, settings.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE);
    this.retry = resolveRetry(settings.retry);
    this.notices = notices ?? null;
    this.createAdapter = settings.createAdapter;
    const reconnect = settings.reconnect === false ? undefined : settings.reconnect;
    this.reconnectCooldownMs = Math.max(0, reconnect?.cooldownMs ?? DEFAULT_RECONNECT_COOLDOWN_MS);
    this.reconnectMaxAttempts = Math.max(1, reconnect?.maxAttempts ?? DEFAULT_RECONNECT_ATTEMPTS);
    this.flushTimer = startUnrefInterval(() => {
      this.pump();
    }, this.flushInterval);
  }

  write(entry: LogEntry): void {
    // Our own notices must never re-enter the write pipeline.
    if (entry.author === NOTICE_AUTHOR) return;
    if (this.closed || LOG_LEVELS[entry.level] < LOG_LEVELS[this.level]) return;
    if (this.recovering && this.buffer.length >= RECOVERY_BACKLOG_CAP) {
      this.dropped += 1;
      return;
    }
    this.buffer.push(entry);
    if (this.buffer.length >= this.batchSize) this.pump();
  }

  writeBatch(entries: LogEntry[]): void {
    for (const entry of entries) this.write(entry);
  }

  /** Take up to batchSize entries from the head of the queue. */
  private takeBatch(): LogEntry[] {
    return this.buffer.splice(0, this.batchSize);
  }

  /**
   * Start writing the next batch when no write is in flight and no retry
   * wait is due. Called from every trigger; concurrent callers collapse
   * into the single in-flight write, which preserves FIFO order.
   */
  private pump(): void {
    if (this.inflight > 0) return;
    // Cooldown wait between rebuild tries blocks delivery; the probe phase
    // (rebuilt adapter draining the backlog) is allowed to write.
    if (this.reconnectTimer !== null) return;
    if (this.buffer.length > 0 && Date.now() < this.retryDueAt) return;
    const batch = this.takeBatch();
    if (batch.length === 0) {
      this.notifyIdle();
      return;
    }
    this.inflight += 1;
    this.writeNext(batch);
  }

  /** Write one batch, then continue draining. Never rejects. */
  private async writeNext(batch: LogEntry[]): Promise<void> {
    const outcome = await attemptAsync(() => this.adapter.write(batch));
    this.inflight -= 1;
    if (!outcome.ok) {
      this.transportErrors += 1;
      this.buffer.unshift(...batch);
      // During close, give the queue one full retry pass before giving up,
      // so a failure right before or during shutdown still gets a second
      // attempt instead of dropping everything silently.
      if (this.closed && !this.closeRetryUsed) {
        this.closeRetryUsed = true;
        queueMicrotask(() => this.pump());
        return;
      }
      // A failing write during the recovery probe is a continued outage:
      // rebuild again instead of running the normal retry schedule.
      if (!this.closed && this.recovering && this.createAdapter !== undefined) {
        this.continueRecovery(outcome.error.message);
        return;
      }
      if (!this.closed && this.retry !== null) {
        this.scheduleRetry(outcome.error.message);
      }
      this.notifyIdle();
      return;
    }
    if (this.recovering) {
      this.recovering = false;
      this.reconnectAttempt = 0;
      this.emitNotice(
        "info",
        `adapter recovered - draining ${this.buffer.length} buffered entries`,
        {
          buffered: this.buffer.length,
          operation: "database.reconnect",
        },
      );
    }
    this.resetRetry();
    this.pump();
  }

  /** Emit a retry/drop notice to the sibling transports (never to ourselves). */
  private emitNotice(level: LogLevel, message: string, context: LogContext): void {
    this.notices?.write({
      author: NOTICE_AUTHOR,
      context,
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /** Count the failed head batch and arm its next attempt, or drop it at the cap. */
  private scheduleRetry(errorMessage: string): void {
    const { retry } = this;
    if (retry === null) return;
    this.retryAttempt += 1;
    const attemptLabel = `${this.retryAttempt}/${Number.isFinite(retry.attempts) ? retry.attempts : "inf"}`;
    if (this.retryAttempt >= retry.attempts) {
      if (this.createAdapter !== undefined) {
        this.startRecovery(errorMessage);
        return;
      }
      const droppedCount = this.takeBatch().length;
      this.dropped += droppedCount;
      this.emitNotice("warn", `write dropped after ${attemptLabel} attempts - ${errorMessage}`, {
        attempt: this.retryAttempt,
        attempts: Number.isFinite(retry.attempts) ? retry.attempts : undefined,
        dropped: droppedCount,
        error: errorMessage,
        operation: "database.write",
      });
      this.resetRetry();
      return;
    }
    const waitMs = applyJitter(retryDelayMs(retry, this.retryAttempt), retry.jitter);
    this.retryDueAt = Date.now() + waitMs;
    stopTimeout(this.retryTimer);
    this.retryTimer = startUnrefTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, waitMs);
    this.emitNotice(
      "debug",
      `write failed - retrying in ${Math.round(waitMs)}ms (attempt ${attemptLabel}): ${errorMessage}`,
      {
        attempt: this.retryAttempt,
        attempts: Number.isFinite(retry.attempts) ? retry.attempts : undefined,
        error: errorMessage,
        operation: "database.write",
        waitMs: Math.round(waitMs),
      },
    );
  }

  /**
   * Rebuild the adapter after an outage: close the dead one, wait the
   * cooldown, call the factory, then probe by draining the backlog.
   * Recovery completes only after a successful write; rebuild tries are
   * capped by `reconnect.maxAttempts`, after which the backlog is dropped.
   */
  private startRecovery(errorMessage: string): void {
    if (this.recovering) return;
    this.recovering = true;
    this.reconnectAttempt = 0;
    this.resetRetry();
    this.emitNotice(
      "warn",
      `adapter down - reconnecting every ${this.reconnectCooldownMs}ms (cap ${this.reconnectMaxAttempts}): ${errorMessage}`,
      {
        cooldownMs: this.reconnectCooldownMs,
        error: errorMessage,
        maxAttempts: this.reconnectMaxAttempts,
        operation: "database.reconnect",
      },
    );
    const dead = this.adapter;
    const closeDead = async (): Promise<void> => {
      try {
        await dead.close?.();
      } catch {
        // Closing a dead adapter is best-effort; its errors stay silent.
      }
    };
    closeDead();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    stopTimeout(this.reconnectTimer);
    this.reconnectTimer = startUnrefTimeout(() => {
      this.reconnectTimer = null;
      // Guarded internally: every failure path lands in failRecoveryAttempt.
      this.attemptReconnect();
    }, this.reconnectCooldownMs);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isClosed() || !this.recovering || this.createAdapter === undefined) return;
    this.reconnectAttempt += 1;
    const factory = this.createAdapter;
    try {
      this.adapter = await factory();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isClosed()) return;
      this.failRecoveryAttempt(`rebuild failed - ${message}`);
      return;
    }
    if (this.isClosed()) {
      this.adapter.close?.();
      return;
    }
    this.emitNotice(
      "debug",
      `adapter rebuilt (try ${this.reconnectAttempt}/${this.reconnectMaxAttempts}) - probing with ${this.buffer.length} buffered entries`,
      {
        attempt: this.reconnectAttempt,
        attempts: this.reconnectMaxAttempts,
        buffered: this.buffer.length,
        operation: "database.reconnect",
      },
    );
    this.pump();
  }

  /** A rebuild try failed (factory or probe write): cap it, then give up. */
  private continueRecovery(message: string): void {
    if (this.reconnectAttempt >= this.reconnectMaxAttempts) {
      this.finishRecoveryFailure(message);
      return;
    }
    this.failRecoveryAttempt(message);
  }

  private failRecoveryAttempt(message: string): void {
    if (this.reconnectAttempt >= this.reconnectMaxAttempts) {
      this.finishRecoveryFailure(message);
      return;
    }
    this.emitNotice(
      "debug",
      `adapter restart failed (${this.reconnectAttempt}/${this.reconnectMaxAttempts}) - ${message}`,
      {
        attempt: this.reconnectAttempt,
        attempts: this.reconnectMaxAttempts,
        error: message,
        operation: "database.reconnect",
      },
    );
    this.scheduleReconnect();
  }

  private finishRecoveryFailure(message: string): void {
    this.recovering = false;
    this.reconnectAttempt = 0;
    stopTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const droppedCount = this.buffer.length;
    this.buffer = [];
    this.dropped += droppedCount;
    this.emitNotice(
      "warn",
      `adapter rebuild failed ${this.reconnectMaxAttempts} times - dropping ${droppedCount} buffered entries - ${message}`,
      {
        dropped: droppedCount,
        error: message,
        maxAttempts: this.reconnectMaxAttempts,
        operation: "database.reconnect",
      },
    );
    this.notifyIdle();
  }

  private resetRetry(): void {
    this.retryAttempt = 0;
    this.retryDueAt = 0;
    stopTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Indirection so TS control flow does not narrow `closed` across awaits. */
  private isClosed(): boolean {
    return this.closed;
  }

  /** Resolve close() waiters once nothing is in flight and nothing is writable. */
  private notifyIdle(): void {
    if (this.inflight > 0 || (this.buffer.length > 0 && !this.closed)) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  stats(): TransportStats {
    return {
      dropped: this.dropped,
      queued: this.buffer.length + this.inflight,
      transportErrors: this.transportErrors,
    };
  }

  /** Trigger a delivery pass without closing; respects a pending backoff wait. */
  flush(): void {
    this.pump();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.finishClose();
    return this.closing;
  }

  private async finishClose(): Promise<void> {
    this.closed = true;
    stopInterval(this.flushTimer);
    this.flushTimer = null;
    // The final drain pass ignores any pending backoff wait and any running
    // recovery: close() must never hang on a dying adapter.
    this.recovering = false;
    stopTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.resetRetry();
    this.closeRetryUsed = false;
    const drained = Promise.withResolvers<null>();
    this.idleWaiters.push(() => {
      drained.resolve(null);
    });
    this.pump();
    await drained.promise;
    await this.adapter.close?.();
  }
}
