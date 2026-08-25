import { LruCache } from "../brain/lru.utils";
import { cachedTimestamp } from "../format/timestamp.format";
import type { AdaptiveSettings, LogEntry } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";

/** Levels that are sampled (throttled) during a storm. */
const SAMPLE_LEVELS = new Set(["debug", "info", "trace"]);
/** Levels counted as errors for the rate window. */
const ERROR_LEVELS = new Set(["error", "fatal"]);

interface StormGroup {
  count: number;
  entry: LogEntry;
}

const stormKey = (entry: LogEntry): string =>
  `${entry.level}\u0000${entry.author}\u0000${entry.message}`;

const makeNotice = (message: string, level: "info" | "warn"): LogEntry => ({
  author: "adaptive",
  context: {},
  level,
  message,
  timestamp: cachedTimestamp(),
});

/**
 * Adaptive throttling: in normal operation it adds nothing but a timestamp
 * push per error entry. When the error rate exceeds the window threshold it
 * switches to "throttled": verbose levels are sampled and repeated errors are
 * collapsed into one summary per group. It returns to normal after a quiet
 * cooldown period.
 */
export class AdaptiveTransport implements Transport {
  private readonly cooldownMs: number;

  private readonly errorRate: number;
  private readonly errors: number[] = [];
  private readonly groups: LruCache<string, StormGroup>;

  private readonly inner: Transport;
  private readonly sample: number;
  private readonly windowMs: number;
  private cooldownStart: number | null = null;
  private throttled = false;

  constructor(inner: Transport, options: AdaptiveSettings = {}) {
    this.inner = inner;
    this.windowMs = options.windowMs ?? 10_000;
    this.errorRate = options.errorRate ?? 20;
    this.sample = options.sample ?? 0.1;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.groups = new LruCache<string, StormGroup>(500);
  }

  write(entry: LogEntry): void {
    this.pushEntries([entry]);
  }

  writeBatch(entries: LogEntry[]): void {
    this.pushEntries(entries);
  }

  stats(): TransportStats {
    return this.inner.stats?.() ?? { dropped: 0, queued: 0, transportErrors: 0 };
  }

  async close(): Promise<void> {
    this.flushGroupSummaries();
    await this.inner.close?.();
  }

  async flush(): Promise<void> {
    this.flushGroupSummaries();
    await this.inner.flush?.();
  }

  private pushEntries(entries: LogEntry[]): void {
    const now = performance.now();
    const stormStarted = this.observe(now, entries);

    // The entry that crossed the threshold is written as-is so the trigger
    // error is visible; everything after it is throttled.
    if (!this.throttled || stormStarted) {
      for (const entry of entries) this.inner.write(entry);
      return;
    }

    for (const entry of entries) {
      if (ERROR_LEVELS.has(entry.level)) {
        this.groupError(entry);
      } else if (SAMPLE_LEVELS.has(entry.level) && Math.random() >= this.sample) {
        continue;
      } else {
        this.inner.write(entry);
      }
    }
  }

  /** Track the error rate and flip the throttling state. Returns true when the storm just started for this batch of entries. */
  private observe(now: number, entries: LogEntry[]): boolean {
    let stormStarted = false;
    for (const entry of entries) {
      if (ERROR_LEVELS.has(entry.level)) this.errors.push(now);
    }
    const windowStart = now - this.windowMs;
    while (this.errors.length > 0 && (this.errors[0] ?? Infinity) < windowStart) {
      this.errors.shift();
    }

    if (!this.throttled && this.errors.length >= this.errorRate) {
      this.throttled = true;
      this.cooldownStart = null;
      stormStarted = true;
      this.notify(
        `storm: ${this.errors.length} errors in ${this.windowMs}ms - sampling verbose levels`,
        "warn",
      );
    }
    if (!this.throttled) return false;

    if (this.errors.length >= this.errorRate) {
      this.cooldownStart = null;
      return stormStarted;
    }
    if (this.cooldownStart === null) this.cooldownStart = now;
    if (now - this.cooldownStart >= this.cooldownMs) {
      this.throttled = false;
      this.cooldownStart = null;
      this.flushGroupSummaries();
      this.notify("storm over - full logging resumed", "info");
    }
    return stormStarted;
  }

  private groupError(entry: LogEntry): void {
    const key = stormKey(entry);
    const group = this.groups.get(key);
    if (group !== undefined) {
      group.count += 1;
      return;
    }
    this.groups.set(key, { count: 1, entry });
  }

  private flushGroupSummaries(): void {
    if (this.groups.size === 0) return;
    for (const key of this.groups.keys()) {
      const group = this.groups.peek(key);
      this.groups.delete(key);
      if (group === undefined || group.count <= 1) continue;
      this.inner.write({
        ...group.entry,
        context: { ...group.entry.context, count: group.count },
        message: `${group.entry.message} ×${group.count}`,
      });
    }
  }

  private notify(message: string, level: "info" | "warn"): void {
    this.inner.write(makeNotice(message, level));
  }
}
