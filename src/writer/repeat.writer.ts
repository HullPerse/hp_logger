import { LruCache } from "../brain/lru.utils";
import type { LogContext, LogEntry, RepeatSettings } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";

interface RepeatGroup {
  count: number;
  entry: LogEntry;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Error signature: name + message + first stack frame; empty without an error. */
const errorFingerprint = (context: LogContext): string => {
  const main = context.error ?? context.reason;
  if (typeof main !== "object" || main === null) return "";
  const error = main as { message?: unknown; name?: unknown; stack?: unknown };
  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : "";
  const firstFrame = typeof error.stack === "string" ? (error.stack.split("\n")[1] ?? "") : "";
  return `${name}|${message}|${firstFrame}`;
};

const repeatKey = (entry: LogEntry): string =>
  `${entry.level}\u0000${entry.author}\u0000${entry.message}\u0000${errorFingerprint(entry.context)}`;

/**
 * Collapse repeated identical entries: the first occurrence is written
 * immediately, duplicates within `windowMs` are counted, and when the window
 * closes the group is written as one summary line `message ×N`. Errors are
 * grouped by their signature (name, message, first stack frame).
 */
export class RepeatTransport implements Transport {
  private readonly groups: LruCache<string, RepeatGroup>;
  private readonly inner: Transport;
  private readonly maxKeys: number;
  private readonly windowMs: number;
  private closed = false;

  constructor(inner: Transport, options: RepeatSettings = {}) {
    this.inner = inner;
    this.windowMs = options.windowMs ?? 1000;
    this.maxKeys = options.maxKeys ?? 1000;
    this.groups = new LruCache<string, RepeatGroup>(this.maxKeys, (key, group) => {
      this.flushGroup(key, group);
    });
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
    if (this.closed) return;
    this.closed = true;
    // Snapshot the keys: flushGroup deletes from the cache while iterating.
    for (const key of this.groups.keys()) this.flushGroup(key);
    await this.inner.close?.();
  }

  private pushEntries(entries: LogEntry[]): void {
    if (this.closed) return;
    for (const entry of entries) {
      const key = repeatKey(entry);
      const group = this.groups.get(key);
      if (group) {
        group.count += 1;
        continue;
      }
      this.inner.write(entry);
      const timer = setTimeout(() => {
        this.flushGroup(key);
      }, this.windowMs);
      timer.unref();
      this.groups.set(key, { count: 1, entry, timer });
    }
  }

  private flushGroup(key: string, known?: RepeatGroup): void {
    const group = known ?? this.groups.get(key);
    if (group === undefined) return;
    this.groups.delete(key);
    if (group.timer !== null) clearTimeout(group.timer);
    if (group.count <= 1) return;
    const { entry } = group;
    this.inner.write({
      ...entry,
      context: { ...entry.context, count: group.count },
      message: `${entry.message} ×${group.count}`,
    });
  }
}