import type { LogEntry } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";
import { emptyStats } from "../lib/transport.utils";

/**
 * Shared base for transports that wrap exactly one inner transport:
 * stats/flush/close delegate by default, subclasses add their own
 * write/writeBatch behavior (gating, grouping, lazy loading).
 */
export abstract class PassthroughTransport implements Transport {
  protected readonly inner: Transport;

  constructor(inner: Transport) {
    this.inner = inner;
  }

  abstract write(entry: LogEntry): void | Promise<void>;

  flush(): void | Promise<void> {
    return this.inner.flush?.();
  }

  close(): void | Promise<void> {
    return this.inner.close?.();
  }

  stats(): TransportStats {
    return this.inner.stats?.() ?? emptyStats();
  }
}
