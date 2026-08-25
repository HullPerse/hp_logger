import type { Logger } from "../api/logger.api";
import { RingBuffer } from "../brain/ring.utils";
import { LEVEL_NAMES, LOG_LEVELS } from "../config/levels.config";
import { buildSpanTree, getSpanRegistry } from "../core/span.core";
import { startUnrefInterval, stopInterval } from "../lib/transport.utils";
import type { LogEntry, LogLevel, SpanRecord } from "../types/logger";
import type { Transport } from "../types/transport";

/** Counts computed by the LogBuffer itself, always present in the stats payload. */
export interface LogBufferStats {
  /** Entries received since the buffer was created (never decremented). */
  receivedTotal: number;
  /** Entries received over the last 1000 ms, sampled on request. */
  eventsPerSecond: number;
  /** Entries received per level since creation. */
  byLevel: Record<LogLevel, number>;
  buffer: {
    size: number;
    capacity: number;
  };
}

/** Public view of a stored entry: the sequence id plus the entry itself. */
export interface StoredEntryPublic {
  /** Monotonic sequence id: poll cursor, WebSocket resume point. */
  id: number;
  entry: LogEntry;
}

/**
 * Remote configuration patch applied by POST /config through
 * `LogControl.apply`. Per-module overrides need a module registry the logger
 * does not have yet, so v1 carries the top-level level only.
 */
export interface LogConfigPatch {
  level?: LogLevel;
}

/**
 * Consumer-provided write surface behind POST /config and POST /flush.
 * Wire it with `createLogControl(logger)`. Both routes stay disabled
 * (they answer 404) unless a server token is configured.
 */
export interface LogControl {
  apply?: (patch: LogConfigPatch) => void;
  flush?: () => void | Promise<void>;
}

export interface LogServerOptions {
  /** Port to listen on. Defaults to 8787. */
  port?: number;
  /** Host to bind. Defaults to 127.0.0.1 (local only). */
  hostname?: string;
  /** Base path for all endpoints. Defaults to "/hp_logger/logs". */
  path?: string;
  /**
   * Bearer token required on every request. When set, requests without it get
   * 401. WebSocket handshakes may pass it as `?token=` instead, because
   * browsers cannot set headers on an upgrade. Without a token the read
   * endpoints are open (loopback by default) and the write endpoints stay
   * disabled.
   */
  token?: string;
  /** Maximum entries kept in the ring buffer. Defaults to 500. */
  capacity?: number;
  /** Optional callback when the server starts, receives the base URL. */
  onStart?: (url: string) => void;
  /** Extra runtime facts merged under `runtime` in the stats payload (logger.stats(), metric snapshots). */
  runtime?: () => unknown | Promise<unknown>;
  /** Source of completed spans for /spans. Defaults to the process span registry. */
  spans?: () => SpanRecord[];
  /** Write surface for /config and /flush. Disabled without a token. */
  control?: LogControl;
  /** Maximum queued entries per WebSocket client before it is closed (1013). Defaults to 10000. */
  maxQueued?: number;
}

interface StoredEntry extends StoredEntryPublic {
  at: number;
}

/** Monotonic id generator for poll cursors and resume points. */
const createId = (): (() => number) => {
  let next = 1;
  return () => {
    const id = next;
    next += 1;
    return id;
  };
};

const emptyByLevel = (): Record<LogLevel, number> => {
  const counts = {} as Record<LogLevel, number>;
  for (const name of LEVEL_NAMES) counts[name] = 0;
  return counts;
};

/**
 * In-process ring buffer of recent entries plus the transport to attach it
 * to a logger. Use with `Logger.addTransport(buffer.transport)` or pass to
 * `createLogServer` to expose it over HTTP polling and WebSocket streaming.
 *
 * Every entry gets a monotonic id: it is the polling cursor (`?after=`),
 * the WebSocket resume point (`{"type":"subscribe","after":N}`), and the
 * sequence number of the replay format.
 */
export class LogBuffer {
  readonly transport: Transport;
  private readonly entries: RingBuffer<StoredEntry>;
  private readonly capacity: number;
  private readonly nextId = createId();
  private readonly listeners = new Set<(stored: StoredEntry) => void>();
  private readonly byLevel = emptyByLevel();
  private receivedTotal = 0;

  constructor(capacity = 500) {
    this.capacity = Math.max(1, capacity);
    this.entries = new RingBuffer<StoredEntry>(this.capacity);
    this.transport = {
      write: (entry) => {
        this.push(entry);
      },
      writeBatch: (entries) => {
        for (const entry of entries) this.push(entry);
      },
    };
  }

  /**
   * Observe every stored entry (id included). Returns the unsubscribe
   * function. Used by the log server to stream live entries; multiple
   * listeners are supported.
   */
  onEntry(listener: (stored: StoredEntryPublic) => void): () => void {
    this.listeners.add(listener as (stored: StoredEntry) => void);
    return () => {
      this.listeners.delete(listener as (stored: StoredEntry) => void);
    };
  }

  /** Current cursor: the id of the newest stored entry, or 0 when empty. */
  cursor(): number {
    return this.entries.toArray().at(-1)?.id ?? 0;
  }

  /** All entries with id > after (new ones only), oldest first. */
  since(after = 0): { entries: LogEntry[]; next: number } {
    return this.collect((id) => id > after);
  }

  /** All entries with id > after including their sequence ids (WebSocket resume). */
  sinceStored(after = 0): StoredEntryPublic[] {
    return this.collectStored((id) => id > after);
  }

  /** The whole ring, oldest first. */
  recent(): { entries: LogEntry[]; next: number } {
    return this.collect(() => true);
  }

  /** Counters sampled on demand: totals, level counts, rate, fill level. */
  statsSnapshot(): LogBufferStats {
    const stored = this.entries.toArray();
    const cutoff = Date.now() - 1000;
    let perSecond = 0;
    for (let index = stored.length - 1; index >= 0; index -= 1) {
      const item = stored[index];
      if (item === undefined || item.at < cutoff) break;
      perSecond += 1;
    }
    return {
      buffer: { capacity: this.capacity, size: stored.length },
      byLevel: { ...this.byLevel },
      eventsPerSecond: perSecond,
      receivedTotal: this.receivedTotal,
    };
  }

  private collect(predicate: (id: number) => boolean): { entries: LogEntry[]; next: number } {
    const entries: LogEntry[] = [];
    for (const stored of this.entries.toArray()) {
      if (predicate(stored.id)) entries.push(stored.entry);
    }
    return { entries, next: this.cursor() };
  }

  private collectStored(predicate: (id: number) => boolean): StoredEntry[] {
    return this.entries.toArray().filter((stored) => predicate(stored.id));
  }

  private push(entry: LogEntry): void {
    const stored: StoredEntry = { at: Date.now(), entry, id: this.nextId() };
    this.entries.push(stored);
    this.receivedTotal += 1;
    this.byLevel[entry.level] += 1;
    for (const listener of this.listeners) listener(stored);
  }
}

const json = (data: unknown, status = 200): Response => Response.json(data, { status });

/** Deliver one client's queued entries as a single events frame. */
const flushClient = (ws: Bun.ServerWebSocket<WsData>): void => {
  const state = ws.data;
  if (!state.subscribed || state.queued.length === 0) return;
  const batch = state.queued.splice(0);
  ws.send(
    JSON.stringify({
      entries: batch.map((stored) => ({ entry: stored.entry, id: stored.id })),
      lastId: batch.at(-1)?.id ?? state.lastSentId,
      type: "events",
    }),
  );
};

const afterFrom = (request: Request): number => {
  const raw = new URL(request.url).searchParams.get("after");
  const parsed = raw === null ? 0 : Math.trunc(Number(raw));
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

/**
 * Wire a logger instance into the control routes: `apply` maps a validated
 * config patch onto the logger settings, `flush` forwards to Logger.flush().
 *
 * ```ts
 * createLogServer(buffer, { token: "secret", control: createLogControl(logger) });
 * ```
 */
export const createLogControl = (logger: Pick<Logger, "settings" | "flush">): LogControl => ({
  apply: (patch) => {
    if (patch.level !== undefined) logger.settings({ level: patch.level });
  },
  flush: () => logger.flush(),
});

const validateLevel = (value: unknown): LogLevel | null =>
  typeof value === "string" && value in LOG_LEVELS ? (value as LogLevel) : null;

/** Strict parser: objects only, known keys only, valid levels only. */
const parseConfigPatch = (body: unknown): LogConfigPatch | null => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const patch: LogConfigPatch = {};
  for (const key of Object.keys(source)) {
    if (key !== "level") return null;
  }
  if (source.level !== undefined) {
    const level = validateLevel(source.level);
    if (level === null) return null;
    patch.level = level;
  }
  return patch;
};

interface SpanSummary {
  traceId: string;
  spans: number;
  latest: string;
}

const summarizeTraces = (records: SpanRecord[], limit = 50): SpanSummary[] => {
  const summaries = new Map<string, SpanSummary>();
  for (const record of records) {
    const seen = summaries.get(record.traceId);
    if (seen === undefined) {
      summaries.set(record.traceId, {
        latest: record.timestamp,
        spans: 1,
        traceId: record.traceId,
      });
    } else {
      seen.spans += 1;
      seen.latest = record.timestamp;
    }
  }
  return [...summaries.values()].slice(-limit);
};

interface WsData {
  queued: StoredEntryPublic[];
  subscribed: boolean;
  lastSentId: number;
}

/**
 * Serve a LogBuffer over HTTP polling and WebSocket streaming:
 *
 * ```ts
 * const buffer = new LogBuffer();
 * Logger.addTransport(buffer.transport);
 * const server = createLogServer(buffer, { port: 8787, token: "secret" });
 * // GET  {url}/hp_logger/logs?after=42   cursor poll (legacy shape)
 * // WS   ws://host/hp_logger/logs         live stream, resume by sequence id
 * // GET  {url}/hp_logger/logs/stats       counters (+ optional runtime hook)
 * // GET  {url}/hp_logger/logs/spans       recent traces, ?traceId= for one tree
 * // POST {url}/hp_logger/logs/config      {"level":"debug"} - needs token + control
 * // POST {url}/hp_logger/logs/flush       deliver buffered entries - same gates
 * ```
 *
 * Auth: when `token` is set, requests must carry `Authorization: Bearer
 * <token>`; WebSocket upgrades may instead use `?token=`. Without a token the
 * read endpoints are open (bind to 127.0.0.1 by default) and the write
 * endpoints are disabled - they answer 404 so the surface stays improbable,
 * matching how the capabilities advertise them.
 *
 * WebSocket protocol (JSON text frames), version 1:
 *
 * - server -> `{"type":"hello","protocol":1,"capabilities":[...],"lastId":N}`
 * - client -> `{"type":"subscribe","after":N}` (after optional: live-only)
 * - server -> `{"type":"subscribed","after":N,"lastId":M}` then streams
 *   `{"type":"events","entries":[{"id":n,"entry":{...}}],"lastId":M}`
 *
 * Reconnecting with the last seen id resumes without loss; a ring truncated
 * past the requested id reports `gap:true` on the replay frame. Frames are
 * flushed every 50 ms; a client whose queue exceeds `maxQueued` is closed
 * with code 1013 and is expected to reconnect and resume.
 */
export const createLogServer = (
  buffer: LogBuffer,
  options: LogServerOptions = {},
): { close: () => void; url: string } => {
  const { port = 8787, hostname = "127.0.0.1", path = "/hp_logger/logs", token } = options;
  const statsPath = `${path}/stats`;
  const spansPath = `${path}/spans`;
  const configPath = `${path}/config`;
  const flushPath = `${path}/flush`;
  const maxQueued = options.maxQueued ?? 10_000;

  const spansSource = options.spans ?? (() => getSpanRegistry().recent(200));

  const capabilities = ["logs", "stats", "spans"];
  const configEnabled = token !== undefined && options.control?.apply !== undefined;
  const flushEnabled = token !== undefined && options.control?.flush !== undefined;
  if (configEnabled) capabilities.push("config");
  if (flushEnabled) capabilities.push("flush");

  const headerAuthorized = (request: Request): boolean =>
    token === undefined || request.headers.get("authorization") === `Bearer ${token}`;

  const clients = new Set<Bun.ServerWebSocket<WsData>>();

  const flushQueues = (): void => {
    for (const ws of clients) flushClient(ws);
  };

  const flushTimer = startUnrefInterval(flushQueues, 50);

  const unsubscribe = buffer.onEntry((stored) => {
    for (const ws of clients) {
      const state = ws.data;
      if (!state.subscribed) continue;
      state.queued.push(stored);
      state.lastSentId = stored.id;
      if (state.queued.length > maxQueued) {
        clients.delete(ws);
        ws.close(1013, "slow consumer");
      }
    }
  });

  const handleStats = async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    const stats = buffer.statsSnapshot();
    if (options.runtime === undefined) return json(stats);
    return json({ ...stats, runtime: await options.runtime() });
  };

  const handleSpans = (request: Request): Response => {
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    const traceId = new URL(request.url).searchParams.get("traceId");
    if (traceId === null) {
      return json({ traces: summarizeTraces(spansSource()) });
    }
    const records = spansSource().filter((record) => record.traceId === traceId);
    return json({ records, traceId, tree: buildSpanTree(records) });
  };

  const handleConfig = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (options.control?.apply === undefined) return json({ error: "not found" }, 404);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const patch = parseConfigPatch(body);
    if (patch === null) {
      return json({ error: 'expected {"level": <valid level>}' }, 400);
    }
    options.control.apply(patch);
    return json({ applied: patch });
  };

  const handleFlush = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    const flush = options.control?.flush;
    if (flush === undefined) return json({ error: "not found" }, 404);
    try {
      await flush();
      return json({ flushed: true });
    } catch {
      return json({ error: "flush failed" }, 500);
    }
  };

  const server = Bun.serve<WsData>({
    fetch: (request, srv) => {
      const url = new URL(request.url);
      const wantsUpgrade =
        url.pathname === path && request.headers.get("upgrade")?.toLowerCase() === "websocket";
      const authorized =
        headerAuthorized(request) ||
        (wantsUpgrade && token !== undefined && url.searchParams.get("token") === token);
      if (!authorized) return json({ error: "unauthorized" }, 401);

      if (wantsUpgrade) {
        const upgraded = srv.upgrade(request, {
          data: { lastSentId: 0, queued: [], subscribed: false },
        });
        return upgraded ? undefined : json({ error: "upgrade failed" }, 400);
      }

      switch (url.pathname) {
        case path: {
          return json(
            afterFrom(request) === 0 ? buffer.recent() : buffer.since(afterFrom(request)),
          );
        }
        case statsPath: {
          return handleStats(request);
        }
        case spansPath: {
          return handleSpans(request);
        }
        case configPath: {
          return configEnabled ? handleConfig(request) : json({ error: "not found" }, 404);
        }
        case flushPath: {
          return flushEnabled ? handleFlush(request) : json({ error: "not found" }, 404);
        }
        default: {
          return json({ error: "not found" }, 404);
        }
      }
    },
    hostname,
    port,
    websocket: {
      close: (ws) => {
        clients.delete(ws);
      },
      message: (ws, raw) => {
        const state = ws.data;
        if (typeof raw !== "string") {
          ws.send(JSON.stringify({ error: "frames must be JSON text", type: "error" }));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          ws.send(JSON.stringify({ error: "invalid JSON", type: "error" }));
          return;
        }
        const frame = parsed as { type?: unknown; after?: unknown };
        if (frame.type !== "subscribe") {
          ws.send(JSON.stringify({ error: "unsupported message", type: "error" }));
          return;
        }
        if (state.subscribed) {
          ws.send(JSON.stringify({ error: "already subscribed", type: "error" }));
          return;
        }
        const requested =
          typeof frame.after === "number" && Number.isFinite(frame.after)
            ? Math.max(0, Math.trunc(frame.after))
            : undefined;
        const replay = requested === undefined ? [] : buffer.sinceStored(requested);
        const firstReplayed = replay[0]?.id;
        const gap =
          requested !== undefined && firstReplayed !== undefined && firstReplayed > requested + 1;
        state.subscribed = true;
        ws.send(
          JSON.stringify({
            lastId: buffer.cursor(),
            ...(requested === undefined ? {} : { after: requested }),
            type: "subscribed",
          }),
        );
        if (replay.length > 0) {
          const lastReplayed = replay.at(-1)?.id ?? requested ?? 0;
          ws.send(
            JSON.stringify({
              entries: replay.map((stored) => ({ entry: stored.entry, id: stored.id })),
              lastId: lastReplayed,
              ...(gap ? { gap: true } : {}),
              type: "events",
            }),
          );
          state.lastSentId = lastReplayed;
        }
      },
      open: (ws) => {
        clients.add(ws);
        ws.send(
          JSON.stringify({
            capabilities,
            lastId: buffer.cursor(),
            protocol: 1,
            type: "hello",
          }),
        );
      },
    },
  });

  const root = `http://${hostname}:${server.port}`;
  options.onStart?.(root);

  return {
    close: () => {
      stopInterval(flushTimer);
      unsubscribe();
      server.stop();
    },
    url: root,
  };
};
