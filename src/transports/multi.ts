import type { Transport, LogEntry } from '../types';

export class MultiTransport implements Transport {
  private readonly transports: Transport[];

  constructor(transports: Transport[]) {
    this.transports = transports;
  }

  async write(entry: LogEntry): Promise<void> {
    await this.writeBatch([entry]);
  }

  async writeBatch(entries: LogEntry[]): Promise<void> {
    const batches = this.transports.map((t) =>
      Promise.resolve(t.writeBatch ? t.writeBatch(entries) : undefined)
    );
    await Promise.all(batches);
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.() ?? Promise.resolve()));
  }
}