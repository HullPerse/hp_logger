import { LOG_LEVELS } from "../config/levels.config.js";
import { dispatchBatch } from "../lib/transport.utils.js";
import type { LogEntry, LogLevel } from "../types/logger.js";
import type { Transport } from "../types/transport.js";
import { PassthroughTransport } from "./passthrough.writer.js";

/**
 * Level gate around an arbitrary transport: only entries at or above
 * `minLevel` pass through - or exactly `minLevel` in exact mode, which the
 * per-level file factory uses. `Logger.addTransport(t, { level })` wraps
 * with this transport.
 */
export class LeveledTransport extends PassthroughTransport {
  private readonly minLevel: LogLevel;
  private readonly exact: boolean;
  private readonly minLevelValue: number;

  constructor(inner: Transport, minLevel: LogLevel, exact = false) {
    super(inner);
    this.minLevel = minLevel;
    this.exact = exact;
    this.minLevelValue = LOG_LEVELS[minLevel];
  }

  private passes(entry: LogEntry): boolean {
    const value = LOG_LEVELS[entry.level];
    return this.exact ? value === this.minLevelValue : value >= this.minLevelValue;
  }

  override write(entry: LogEntry): void | Promise<void> {
    if (!this.passes(entry)) return;
    return this.inner.write(entry);
  }

  async writeBatch(entries: LogEntry[]): Promise<void> {
    const filtered = entries.filter((entry) => this.passes(entry));
    if (filtered.length === 0) return;
    await dispatchBatch(this.inner, filtered);
  }
}
