import type {
  DatabaseSettings,
  Transport,
  TransportStats,
} from "../types/transport";

/** Structural module shape of the dynamically imported database writer. */
interface DatabaseModule {
  DatabaseTransport: new (
    settings: DatabaseSettings,
    notices?: Transport
  ) => Transport;
}

const resolveDatabaseModule = (): Promise<DatabaseModule> =>
  import.meta.url.endsWith(".ts")
    ? (import("./database.writer") as Promise<DatabaseModule>)
    : (import("./database.writer.js") as Promise<DatabaseModule>);

/**
 * Wraps DatabaseTransport behind a dynamic import so the database writer
 * (and its bundled sqlite adapter) never enter the main entry's module
 * graph unless `settings.database` is actually enabled. The missing-adapter
 * chec runs eagerly so misconfiguration still fails at logger creation;
 * the heavy module only loads on the first entry that needs it.
 *
 * The inner transport is created once and cached; close() awaits the load
 * (if pending) and the inner transport's own drain, so shutdown never
 * drops entries queued around the lazy load.
 */
export class LazyDatabaseTransport implements Transport {
  private inner: Transport | null = null;
  private loading: Promise<Transport> | null = null;
  private readonly settings: DatabaseSettings;
  private readonly notices: Transport | null;

  constructor(settings: DatabaseSettings, notices?: Transport) {
    this.settings = settings;
    this.notices = notices ?? null;
    if (!settings.adapter) {
      throw new Error("DatabaseTransport requires an adapter when enabled");
    }
  }

  /** Load the heavy module once; concurrent callers share the same attempt. */
  private ensure(): Promise<Transport> {
    if (this.inner !== null) return Promise.resolve(this.inner);
    this.loading ??= this.loadInner();
    return this.loading;
  }

  private async loadInner(): Promise<Transport> {
    const mod = await resolveDatabaseModule();
    const transport = new mod.DatabaseTransport(this.settings, this.notices ?? undefined);
    this.inner = transport;
    return transport;
  }

  async write(entry: Parameters<Transport["write"]>[0]): Promise<void> {
    const transport = await this.ensure();
    await transport.write(entry);
  }

  async writeBatch(entries: Parameters<NonNullable<Transport["writeBatch"]>>[0]): Promise<void> {
    const transport = await this.ensure();
    await transport.writeBatch?.(entries);
  }

  async flush(): Promise<void> {
    if (this.inner === null) return;
    await this.inner.flush?.();
  }

  /** Awaits a pending lazy load, then closes and drains the inner transport. */
  async close(): Promise<void> {
    const transport = await this.ensure();
    await transport.close?.();
  }

  stats(): TransportStats {
    return (
      this.inner?.stats?.() ?? {
        dropped: 0,
        queued: 0,
        transportErrors: 0,
      }
    );
  }
}