import { dispatchBatch } from "../lib/transport.utils";
import type { LogEntry } from "../types/logger";
import type { Transport, TransportStats } from "../types/transport";

export class MultiTransport implements Transport {
  private readonly transports: Transport[];

  constructor(transports: Transport[]) {
    this.transports = transports;
  }

  async write(entry: LogEntry): Promise<void> {
    await this.writeBatch([entry]);
  }

  async writeBatch(entries: LogEntry[]): Promise<void> {
    const batches = this.transports.map((transport) => dispatchBatch(transport, entries));
    await Promise.all(batches);
  }

  stats(): TransportStats {
    const total: TransportStats = { dropped: 0, queued: 0, transportErrors: 0 };
    for (const transport of this.transports) {
      const stats = transport.stats?.();
      if (!stats) continue;
      total.dropped += stats.dropped;
      total.queued += stats.queued;
      total.transportErrors += stats.transportErrors;
    }
    return total;
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.() ?? Promise.resolve()));
  }
}
