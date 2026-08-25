import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once as onceEvent } from "node:events";

import type { Logger } from "@/api/logger.api";
import { createLogControl, createLogServer, LogBuffer } from "@/http/log.server";
import type { StoredEntryPublic } from "@/http/log.server";
import type { LogEntry, SpanRecord } from "@/types/logger";

type Frame = Record<string, unknown>;

const entry = (message: string, level: LogEntry["level"] = "info"): LogEntry => ({
  author: "test",
  context: { requestId: "abc" },
  level,
  message,
  timestamp: "2026-08-24 12:00:00",
});

const spanRecord = (traceId: string, spanId: string, parentId?: string): SpanRecord => ({
  durationMs: 5,
  level: "success",
  message: `${spanId} done`,
  name: spanId,
  parentId,
  spanId,
  timestamp: "2026-08-25 12:00:00",
  traceId,
});

const waitForOpen = (socket: WebSocket): Promise<unknown> => onceEvent(socket, "open");

/** Attach a frame collector; next() awaits the first matching unseen frame. */
const collectFrames = (
  socket: WebSocket,
): {
  next: <T>(predicate: (frame: Frame) => boolean, timeoutMs?: number) => Promise<T>;
} => {
  const seen: Frame[] = [];
  socket.addEventListener("message", (event: MessageEvent) => {
    seen.push(JSON.parse(String(event.data)) as Frame);
  });
  return {
    next: async <T>(predicate: (frame: Frame) => boolean, timeoutMs = 2000): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = seen.findIndex(predicate);
        if (index !== -1) return seen.splice(index, 1)[0] as T;
        if (Date.now() > deadline) throw new Error("frame timeout");
        await Bun.sleep(10);
      }
    },
  };
};

describe("LogBuffer", () => {
  test("collects entries and serves polling cursors", () => {
    const buffer = new LogBuffer(3);
    buffer.transport.write(entry("one"));
    buffer.transport.write(entry("two"));

    const first = buffer.recent();
    expect(first.entries.map((item) => item.message)).toEqual(["one", "two"]);
    const next = buffer.since(first.next);
    expect(next.entries).toEqual([]);

    buffer.transport.write(entry("three"));
    const deltas = buffer.since(first.next);
    expect(deltas.entries.map((item) => item.message)).toEqual(["three"]);
  });

  test("keeps only the last capacity entries", () => {
    const buffer = new LogBuffer(2);
    buffer.transport.write(entry("one"));
    buffer.transport.write(entry("two"));
    buffer.transport.write(entry("three"));
    expect(buffer.recent().entries.map((item) => item.message)).toEqual(["two", "three"]);
  });

  test("exposes the monotonic cursor even past ring eviction", () => {
    const buffer = new LogBuffer(2);
    buffer.transport.write(entry("one"));
    buffer.transport.write(entry("two"));
    expect(buffer.cursor()).toBe(2);
    buffer.transport.write(entry("three"));
    expect(buffer.cursor()).toBe(3);
    expect(buffer.sinceStored(2).map((stored) => stored.id)).toEqual([3]);
  });

  test("statsSnapshot counts totals and levels with rate and fill", () => {
    const buffer = new LogBuffer(10);
    buffer.transport.writeBatch?.([entry("a", "info"), entry("b", "error"), entry("c", "error")]);
    const stats = buffer.statsSnapshot();
    expect(stats.receivedTotal).toBe(3);
    expect(stats.byLevel.error).toBe(2);
    expect(stats.byLevel.info).toBe(1);
    expect(stats.byLevel.fatal).toBe(0);
    expect(stats.eventsPerSecond).toBeGreaterThanOrEqual(3);
    expect(stats.buffer).toEqual({ capacity: 10, size: 3 });
  });

  test("onEntry delivers every stored entry until unsubscribed", () => {
    const buffer = new LogBuffer();
    const seen: StoredEntryPublic[] = [];
    const unsubscribe = buffer.onEntry((stored) => seen.push(stored));
    buffer.transport.write(entry("first"));
    unsubscribe();
    buffer.transport.write(entry("second"));
    expect(seen.map((stored) => stored.entry.message)).toEqual(["first"]);
    expect(seen[0]?.id).toBe(1);
  });
});

describe("log server routes", () => {
  let buffer: LogBuffer;
  let server: ReturnType<typeof createLogServer>;
  let flushCount: number;
  const appliedPatches: Record<string, unknown>[] = [];

  beforeAll(() => {
    buffer = new LogBuffer();
    flushCount = 0;
    const fakeLogger = {
      flush: (): Promise<void> => {
        flushCount += 1;
        return Promise.resolve();
      },
      settings: (changes: Record<string, unknown>): unknown => {
        appliedPatches.push(changes);
        return fakeLogger;
      },
    } as unknown as Pick<Logger, "settings" | "flush">;
    server = createLogServer(buffer, {
      control: createLogControl(fakeLogger),
      port: 0,
      runtime: () => ({ loggerStats: { dropped: 0, queued: 0, transportErrors: 0 } }),
      spans: () => [spanRecord("t1", "s1"), spanRecord("t1", "s2", "s1"), spanRecord("t2", "s9")],
      token: "sekret",
    });
  });

  afterAll(() => {
    server.close();
  });

  const auth = { authorization: "Bearer sekret" };

  test("serves the ring buffer over HTTP with cursor polling", async () => {
    buffer.transport.write(entry("hello"));
    const response = await fetch(`${server.url}/hp_logger/logs`, { headers: auth });
    const payload = (await response.json()) as { entries: { message: string }[]; next: number };
    expect(payload.entries.map((item) => item.message)).toContain("hello");

    buffer.transport.write(entry("world"));
    const deltaResponse = await fetch(`${server.url}/hp_logger/logs?after=${payload.next}`, {
      headers: auth,
    });
    const delta = (await deltaResponse.json()) as { entries: { message: string }[] };
    expect(delta.entries.map((item) => item.message)).toEqual(["world"]);
  });

  test("requires the bearer token", async () => {
    const response = await fetch(`${server.url}/hp_logger/logs`);
    expect(response.status).toBe(401);
  });

  test("returns 401 without a token even for unknown paths", async () => {
    const response = await fetch(`${server.url}/nope`);
    expect(response.status).toBe(401);
  });

  test("returns 404 for unknown paths with the token", async () => {
    const response = await fetch(`${server.url}/nope`, { headers: auth });
    expect(response.status).toBe(404);
  });

  test("stats route reports buffer counters and merges the runtime hook", async () => {
    buffer.transport.write(entry("counted", "warn"));
    const response = await fetch(`${server.url}/hp_logger/logs/stats`, { headers: auth });
    const stats = (await response.json()) as {
      receivedTotal: number;
      eventsPerSecond: number;
      byLevel: Record<string, number>;
      buffer: { size: number; capacity: number };
      runtime: { loggerStats: { queued: number } };
    };
    expect(stats.receivedTotal).toBeGreaterThan(0);
    expect(stats.byLevel.warn).toBeGreaterThan(0);
    expect(stats.buffer.capacity).toBe(500);
    expect(stats.runtime.loggerStats.queued).toBe(0);

    const denied = await fetch(`${server.url}/hp_logger/logs/stats`, {
      headers: auth,
      method: "POST",
    });
    expect(denied.status).toBe(405);
  });

  test("spans route lists recent traces and builds one tree per traceId", async () => {
    const listResponse = await fetch(`${server.url}/hp_logger/logs/spans`, { headers: auth });
    const list = (await listResponse.json()) as { traces: { traceId: string; spans: number }[] };
    expect(list.traces.map((trace) => trace.traceId)).toEqual(["t1", "t2"]);
    expect(list.traces[0]?.spans).toBe(2);

    const treeResponse = await fetch(`${server.url}/hp_logger/logs/spans?traceId=t1`, {
      headers: auth,
    });
    const tree = (await treeResponse.json()) as {
      records: SpanRecord[];
      tree: { children: { record: { spanId: string } }[]; record: { spanId: string } }[];
      traceId: string;
    };
    expect(tree.traceId).toBe("t1");
    expect(tree.records).toHaveLength(2);
    expect(tree.tree).toHaveLength(1);
    expect(tree.tree[0]?.children[0]?.record.spanId).toBe("s2");

    const denied = await fetch(`${server.url}/hp_logger/logs/spans`, {
      headers: auth,
      method: "POST",
    });
    expect(denied.status).toBe(405);
  });

  test("config route applies validated patches through createLogControl", async () => {
    const good = await fetch(`${server.url}/hp_logger/logs/config`, {
      body: JSON.stringify({ level: "debug" }),
      headers: { ...auth, "content-type": "application/json" },
      method: "POST",
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ applied: { level: "debug" } });
    expect(appliedPatches.at(-1)).toEqual({ level: "debug" });

    const badLevel = await fetch(`${server.url}/hp_logger/logs/config`, {
      body: JSON.stringify({ level: "loud" }),
      headers: { ...auth, "content-type": "application/json" },
      method: "POST",
    });
    expect(badLevel.status).toBe(400);

    const unknownKey = await fetch(`${server.url}/hp_logger/logs/config`, {
      body: JSON.stringify({ level: "info", modules: { web: "debug" } }),
      headers: { ...auth, "content-type": "application/json" },
      method: "POST",
    });
    expect(unknownKey.status).toBe(400);

    const brokenJson = await fetch(`${server.url}/hp_logger/logs/config`, {
      body: "{oops",
      headers: { ...auth, "content-type": "application/json" },
      method: "POST",
    });
    expect(brokenJson.status).toBe(400);
  });

  test("flush route forwards to the control hook", async () => {
    const response = await fetch(`${server.url}/hp_logger/logs/flush`, {
      headers: auth,
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flushed: true });
    expect(flushCount).toBe(1);
  });

  test("write routes answer 404 when the server has no token or control", async () => {
    const open = createLogServer(new LogBuffer(), {
      control: createLogControl({
        flush: (): Promise<void> => Promise.resolve(),
        settings: (() => null) as unknown as Pick<Logger, "settings">["settings"],
      }),
      port: 0,
    });
    try {
      const config = await fetch(`${open.url}/hp_logger/logs/config`, {
        body: JSON.stringify({}),
        method: "POST",
      });
      expect(config.status).toBe(404);
      const flush = await fetch(`${open.url}/hp_logger/logs/flush`, { method: "POST" });
      expect(flush.status).toBe(404);
    } finally {
      open.close();
    }
  });

  test("replay contract: polled entries carry the core entry fields", async () => {
    const response = await fetch(`${server.url}/hp_logger/logs`, { headers: auth });
    const payload = (await response.json()) as { entries: LogEntry[] };
    for (const key of ["author", "level", "message", "timestamp"]) {
      expect(Object.keys(payload.entries[0] ?? {})).toContain(key);
    }
  });
});

describe("websocket stream", () => {
  let buffer: LogBuffer;
  let server: ReturnType<typeof createLogServer>;

  const wsUrl = (): string => `${server.url.replace(/^http/u, "ws")}/hp_logger/logs?token=sekret`;

  beforeAll(() => {
    buffer = new LogBuffer();
    server = createLogServer(buffer, { port: 0, token: "sekret" });
  });

  afterAll(() => {
    server.close();
  });

  test("greets with protocol version and capabilities, then replays and streams", async () => {
    buffer.transport.write(entry("old"));
    const socket = new WebSocket(wsUrl());
    await waitForOpen(socket);
    try {
      const frames = collectFrames(socket);
      const hello = await frames.next<{ capabilities: string[]; lastId: number; protocol: number }>(
        (frame) => frame.type === "hello",
      );
      expect(hello.protocol).toBe(1);
      expect(hello.capabilities).toContain("logs");
      expect(hello.capabilities).not.toContain("config");

      socket.send(JSON.stringify({ after: 0, type: "subscribe" }));
      const ack = await frames.next<{ lastId: number }>((frame) => frame.type === "subscribed");
      expect(ack.lastId).toBe(1);

      const replay = await frames.next<{
        entries: { entry: { message: string } }[];
        lastId: number;
      }>((frame) => frame.type === "events");
      expect(replay.entries.map((stored) => stored.entry.message)).toEqual(["old"]);

      buffer.transport.write(entry("live"));
      const live = await frames.next<{ entries: { entry: { message: string } }[] }>((frame) => {
        const stored = frame.entries as { entry: { message: string } }[] | undefined;
        return frame.type === "events" && Array.isArray(stored)
          ? stored.some((item) => item.entry.message === "live")
          : false;
      });
      expect(live.entries).toHaveLength(1);
    } finally {
      socket.close();
    }
  });

  test("resumes from a sequence id without gaps", async () => {
    buffer.transport.write(entry("r1"));
    buffer.transport.write(entry("r2"));
    const socket = new WebSocket(wsUrl());
    await waitForOpen(socket);
    try {
      const frames = collectFrames(socket);
      socket.send(JSON.stringify({ after: buffer.cursor() - 1, type: "subscribe" }));
      const replay = await frames.next<{
        entries: { entry: { message: string } }[];
        gap?: boolean;
      }>((frame) => frame.type === "events");
      expect(replay.gap).toBeUndefined();
      expect(replay.entries.map((stored) => stored.entry.message)).toEqual(["r2"]);
    } finally {
      socket.close();
    }
  });

  test("reports a gap when the ring was truncated past the requested id", async () => {
    const tiny = new LogBuffer(2);
    tiny.transport.write(entry("g1"));
    tiny.transport.write(entry("g2"));
    tiny.transport.write(entry("g3"));
    const tinyServer = createLogServer(tiny, { port: 0, token: "sekret" });
    try {
      const socket = new WebSocket(
        `${tinyServer.url.replace(/^http/u, "ws")}/hp_logger/logs?token=sekret`,
      );
      await waitForOpen(socket);
      try {
        const frames = collectFrames(socket);
        socket.send(JSON.stringify({ after: 0, type: "subscribe" }));
        const replay = await frames.next<{ entries: unknown[]; gap?: boolean }>(
          (frame) => frame.type === "events",
        );
        expect(replay.gap).toBe(true);
        expect(replay.entries).toHaveLength(2);
      } finally {
        socket.close();
      }
    } finally {
      tinyServer.close();
    }
  });

  test("answers malformed frames with error messages", async () => {
    const socket = new WebSocket(wsUrl());
    await waitForOpen(socket);
    try {
      const frames = collectFrames(socket);
      socket.send("{broken");
      const invalid = await frames.next<{ error: string }>((frame) => frame.type === "error");
      expect(invalid.error).toBe("invalid JSON");

      socket.send(JSON.stringify({ type: "mystery" }));
      const unsupported = await frames.next<{ error: string }>((frame) => frame.type === "error");
      expect(unsupported.error).toBe("unsupported message");

      socket.send(JSON.stringify({ type: "subscribe" }));
      await frames.next((frame) => frame.type === "subscribed");
      socket.send(JSON.stringify({ type: "subscribe" }));
      const duplicate = await frames.next<{ error: string }>((frame) => frame.type === "error");
      expect(duplicate.error).toBe("already subscribed");
    } finally {
      socket.close();
    }
  });

  test("rejects unauthorized upgrades with 401", async () => {
    const response = await fetch(`${server.url}/hp_logger/logs`, {
      headers: {
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        upgrade: "websocket",
      },
    });
    expect(response.status).toBe(401);
  });
});
