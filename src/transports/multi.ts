import type { Transport, LogEntry } from '../types';

export class MultiTransport implements Transport {
  private readonly transports: Transport[];

  constructor(transports: Transport[]) {
    this.transports = transports;
  }

  async write(entry: LogEntry): Promise<void> {
    const promises = this.transports.map((t) => Promise.resolve(t.write(entry)));
    await Promise.all(promises);
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.() ?? Promise.resolve()));
  }
}