import { GroupCounter } from "../brain/group.utils.js";
import { countSummary, startUnrefTimeout, stopTimeout } from "../lib/transport.utils.js";
import type { LogContext, LogEntry, RepeatSettings } from "../types/logger.js";
import type { Transport } from "../types/transport.js";
import { PassthroughTransport } from "./passthrough.writer.js";

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
export class RepeatTransport extends PassthroughTransport {
  private readonly groups: GroupCounter<string, RepeatGroup>;
  private readonly windowMs: number;
  private closed = false;

  constructor(inner: Transport, options: RepeatSettings = {}) {
    super(inner);
    this.windowMs = options.windowMs ?? 1000;
    const maxKeys = options.maxKeys ?? 1000;
    // Evicted groups never reach their window timer: flush them now.
    this.groups = new GroupCounter<string, RepeatGroup>(maxKeys, (_key, group) => {
      stopTimeout(group.timer);
      this.writeSummary(group);
    });
  }

  override write(entry: LogEntry): void {
    this.pushEntries([entry]);
  }

  writeBatch(entries: LogEntry[]): void {
    this.pushEntries(entries);
  }

  override async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.drainAll();
    await this.inner.close?.();
  }

  override async flush(): Promise<void> {
    this.drainAll();
    await this.inner.flush?.();
  }

  private pushEntries(entries: LogEntry[]): void {
    if (this.closed) return;
    for (const entry of entries) {
      const key = repeatKey(entry);
      if (this.groups.absorb(key)) continue;
      this.inner.write(entry);
      const timer = startUnrefTimeout(() => {
        this.flushGroup(key);
      }, this.windowMs);
      this.groups.start(key, { count: 1, entry, timer });
    }
  }

  private drainAll(): void {
    this.groups.drain((group) => {
      stopTimeout(group.timer);
      this.writeSummary(group);
    });
  }

  private flushGroup(key: string): void {
    const group = this.groups.take(key);
    if (group === undefined) return;
    stopTimeout(group.timer);
    this.writeSummary(group);
  }

  private writeSummary(group: RepeatGroup): void {
    if (group.count <= 1) return;
    this.inner.write(countSummary(group.entry, group.count));
  }
}
