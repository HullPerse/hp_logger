import { LOG_LEVELS } from "../config/levels.config";
import type { LogEntry, LogLevel } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";

/**
 * Level gate around an arbitrary transport: only entries at or above
 * `minLevel` pass through - or exactly `minLevel` in exact mode, which the
 * per-level file factory uses. `Logger.addTransport(t, { level })` wraps
 * with this transport.
 */
export class LeveledTransport implements Transport {
  private readonly inner: Transport;
  private readonly minLevel: LogLevel;
  private readonly exact: boolean;
  private readonly minLevelValue: number;

  constructor(inner: Transport, minLevel: LogLevel, exact = false) {
    this.inner = inner;
    this.minLevel = minLevel;
    this.exact = exact;
    this.minLevelValue = LOG_LEVELS[minLevel];
  }

  private passes(entry: LogEntry): boolean {
    const value = LOG_LEVELS[entry.level];
    return this.exact ? value === this.minLevelValue : value >= this.minLevelValue;
  }

  write(entry: LogEntry): void | Promise<void> {
    if (!this.passes(entry)) return;
    return this.inner.write(entry);
  }

  async writeBatch(entries: LogEntry[]): Promise<void> {
    const filtered = entries.filter((entry) => this.passes(entry));
    if (filtered.length === 0) return;
    const batched = this.inner.writeBatch?.(filtered);
    if (batched !== undefined) {
      await batched;
      return;
    }
    await this.deliverSequentially(filtered);
  }

  private async deliverSequentially(entries: LogEntry[]): Promise<void> {
    const [first, ...rest] = entries;
    if (first === undefined) return;
    await this.inner.write(first);
    await this.deliverSequentially(rest);
  }

  flush(): void | Promise<void> {
    return this.inner.flush?.();
  }

  close(): void | Promise<void> {
    return this.inner.close?.();
  }

  stats(): TransportStats {
    return this.inner.stats?.() ?? { dropped: 0, queued: 0, transportErrors: 0 };
  }
}
