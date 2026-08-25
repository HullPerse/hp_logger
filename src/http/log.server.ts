import { RingBuffer } from "../brain/ring.utils";
import type { LogEntry } from "../types/logger";
import type { Transport } from "../types/transport";

export interface LogServerOptions {
  /** Port to listen on. Defaults to 8787. */
  port?: number;
  /** Host to bind. Defaults to 127.0.0.1 (local only). */
  hostname?: string;
  /** URL path for the logs endpoint, e.g. "/hp_logger/logs". Defaults to "/hp_logger/logs". */
  path?: string;
  /** Bearer token required on every request. When set, requests without it get 401. */
  token?: string;
  /** Maximum entries kept in the ring buffer. Defaults to 500. */
  capacity?: number;
  /** Optional callback when the server starts, receives the base URL. */
  onStart?: (url: string) => void;
}

interface StoredEntry {
  entry: LogEntry;
  id: number;
}

/** Monotonic id generator for poll cursors. */
const createId = (): (() => number) => {
  let next = 1;
  return () => {
    const id = next;
    next += 1;
    return id;
  };
};

/**
 * In-process ring buffer of recent entries plus the transport to attach it
 * to a logger. Use with `Logger.addTransport(buffer.transport)` or pass to
 * `createLogServer` to expose it as a polled HTTP endpoint.
 */
export class LogBuffer {
  readonly transport: Transport;
  private readonly entries: RingBuffer<StoredEntry>;
  private readonly nextId = createId();

  constructor(capacity = 500) {
    this.entries = new RingBuffer<StoredEntry>(capacity);
    this.transport = {
      write: (entry) => {
        this.push(entry);
      },
      writeBatch: (entries) => {
        for (const entry of entries) this.push(entry);
      },
    };
  }

  /** All entries with id > after (new ones only), oldest first. */
  since(after = 0): { entries: LogEntry[]; next: number } {
    return this.collect((id) => id > after);
  }

  /** The whole ring, oldest first. */
  recent(): { entries: LogEntry[]; next: number } {
    return this.collect(() => true);
  }

  private collect(predicate: (id: number) => boolean): { entries: LogEntry[]; next: number } {
    const entries: LogEntry[] = [];
    for (const stored of this.entries.toArray()) {
      if (predicate(stored.id)) entries.push(stored.entry);
    }
    const last = this.entries.toArray().at(-1);
    return { entries, next: last === undefined ? 0 : last.id };
  }

  private push(entry: LogEntry): void {
    this.entries.push({ entry, id: this.nextId() });
  }
}

const json = (data: unknown, status = 200): Response => Response.json(data, { status });

const afterFrom = (request: Request): number => {
  const raw = new URL(request.url).searchParams.get("after");
  const parsed = raw === null ? 0 : Math.trunc(Number(raw));
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Serve a LogBuffer over HTTP for browser polling:
 *
 * ```ts
 * const buffer = new LogBuffer();
 * Logger.addTransport(buffer.transport);
 * const server = createLogServer(buffer, { port: 8787, token: "secret" });
 * // GET http://127.0.0.1:8787/hp_logger/logs?after=42 → JSON poll
 * ```
 *
 * Auth: when `token` is set, requests must carry `Authorization: Bearer
 * <token>`. Bind to 127.0.0.1 by default so the endpoint is not exposed to
 * the network unless the consumer configures a hostname.
 */
export const createLogServer = (
  buffer: LogBuffer,
  options: LogServerOptions = {},
): { close: () => void; url: string } => {
  const { port = 8787, hostname = "127.0.0.1", path = "/hp_logger/logs", token } = options;

  const server = Bun.serve({
    fetch: (request) => {
      const authorized =
        token === undefined || request.headers.get("authorization") === `Bearer ${token}`;
      if (!authorized) {
        return json({ error: "unauthorized" }, 401);
      }
      const url = new URL(request.url);
      if (url.pathname === path) {
        const after = afterFrom(request);
        const payload = after === 0 ? buffer.recent() : buffer.since(after);
        return json(payload);
      }
      return json({ error: "not found" }, 404);
    },
    hostname,
    port,
  });

  const root = `http://${hostname}:${server.port}`;
  options.onStart?.(root);

  return {
    close: () => {
      server.stop();
    },
    url: root,
  };
};
