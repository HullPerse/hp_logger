import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createLogger } from "@/index.logger";
import { captureLogger, withMutedConsole } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import { DatabaseTransport } from "@/writer/database.writer";
import { createSqliteAdapter } from "@/writer/sqlite.writer";

const entry = (message: string): LogEntry => ({
  author: "TEST",
  context: {},
  level: "info",
  message,
  timestamp: message,
});

describe("sqlite adapter schema", () => {
  test("rejects an existing table with a different schema", () => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE logs (id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
    expect(() => createSqliteAdapter(db)).toThrow(/unexpected schema/u);
  });

  test("appends to an existing table that already matches the logger schema", async () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        author TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}'
      )
    `);
    const logger = createLogger({
      settings: {
        database: { adapter: createSqliteAdapter(db), enabled: true },
        file: false,
        mode: "json",
      },
    });

    await withMutedConsole(async () => {
      logger.info("append me");
      await logger.close();
    });

    const rows = db.query("SELECT message FROM logs").all() as { message: string }[];
    expect(rows.map((row) => row.message)).toEqual(["append me"]);
  });

  test("rejects an unsafe table name", () => {
    const db = new Database(":memory:");
    expect(() => createSqliteAdapter(db, { table: "logs; DROP TABLE users" })).toThrow(
      /Invalid sqlite table name/u,
    );
  });
});

describe("DatabaseTransport", () => {
  test("persists entries through the sqlite adapter", async () => {
    const db = new Database(":memory:");
    const logger = createLogger({
      settings: {
        database: {
          adapter: createSqliteAdapter(db),
          enabled: true,
          level: "debug",
        },
        file: false,
        level: "debug",
        mode: "json",
      },
    });

    await withMutedConsole(async () => {
      logger.info("hello db", { userId: 42 });
      logger.warn("careful", { path: "/x" });
      await logger.close();
    });

    const rows = db.query("SELECT * FROM logs ORDER BY id").all() as {
      author: string;
      context: string;
      level: string;
      message: string;
    }[];
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows;
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error("expected two log rows");
    }
    expect(firstRow).toMatchObject({
      author: "ROOT",
      level: "info",
      message: "hello db",
    });
    expect(JSON.parse(firstRow.context)).toEqual({ userId: 42 });
    expect(secondRow.level).toBe("warn");
  });

  test("level filter drops entries below the configured level", async () => {
    const db = new Database(":memory:");
    const logger = createLogger({
      settings: {
        database: {
          adapter: createSqliteAdapter(db),
          enabled: true,
          level: "warn",
        },
        file: false,
        level: "debug",
        mode: "json",
      },
    });

    await withMutedConsole(async () => {
      logger.debug("hidden");
      logger.info("hidden too");
      logger.warn("kept");
      logger.error("kept too");
      await logger.close();
    });

    const rows = db.query("SELECT * FROM logs ORDER BY id").all() as {
      level: string;
    }[];
    expect(rows.map((row) => row.level)).toEqual(["warn", "error"]);
  });

  test("serializes overlapping flushes and preserves FIFO order", async () => {
    const writes: string[][] = [];
    const firstWrite = Promise.withResolvers<null>();
    const adapter = {
      async write(entries: LogEntry[]) {
        writes.push(entries.map((item) => item.message));
        if (writes.length === 1) await firstWrite.promise;
      },
    };
    const transport = new DatabaseTransport({
      adapter,
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
    });

    transport.write(entry("first"));
    transport.write(entry("second"));
    const closing = transport.close();
    await Promise.resolve();
    expect(writes).toEqual([["first"]]);
    firstWrite.resolve(null);
    await closing;
    expect(writes).toEqual([["first"], ["second"]]);
  });

  test("close waits for an in-flight batch before closing the adapter", async () => {
    const writeStarted = Promise.withResolvers<null>();
    let closed = false;
    const transport = new DatabaseTransport({
      adapter: {
        close() {
          closed = true;
        },
        async write() {
          await writeStarted.promise;
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
    });
    transport.write(entry("entry"));
    const closing = transport.close();
    await Promise.resolve();
    expect(closed).toBe(false);
    writeStarted.resolve(null);
    await closing;
    expect(closed).toBe(true);
  });

  test("a failing write keeps its batch and later writes stay ordered", async () => {
    const calls: string[][] = [];
    const rows: string[] = [];
    let failFirstCall = true;
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          calls.push(entries.map((item) => item.message));
          if (failFirstCall) {
            failFirstCall = false;
            throw new Error("disk full");
          }
          for (const item of entries) rows.push(item.message);
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 2,
    });

    transport.write(entry("a1"));
    transport.write(entry("a2"));
    transport.write(entry("b1"));
    await transport.close();

    expect(calls).toHaveLength(3);
    expect(rows).toEqual(["a1", "a2", "b1"]);
  });

  test("batches never exceed maxBufferSize", async () => {
    const sizes: number[] = [];
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          sizes.push(entries.length);
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 2,
    });

    for (let i = 0; i < 5; i += 1) transport.write(entry(`m${i}`));
    await transport.close();
    expect(sizes).toEqual([2, 2, 1]);
  });

  test("close is idempotent and closes the adapter once", async () => {
    let closeCalls = 0;
    const transport = new DatabaseTransport({
      adapter: {
        close() {
          closeCalls += 1;
        },
        write() {},
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 10,
    });

    await Promise.all([transport.close(), transport.close()]);
    expect(closeCalls).toBe(1);
  });

  test("close finishes despite a persistently failing adapter", async () => {
    let closeCalled = false;
    const transport = new DatabaseTransport({
      adapter: {
        close() {
          closeCalled = true;
        },
        write() {
          throw new Error("always fails");
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 10,
    });

    transport.write(entry("lost"));
    await transport.close();
    expect(closeCalled).toBe(true);
  });

  test("disabled database settings create no transport", () => {
    const { entries, logger } = captureLogger({
      database: false,
      file: false,
      mode: "json",
    });
    logger.info("no db");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("no db");
  });

  test("enabled database without adapter throws", () => {
    expect(() =>
      createLogger({
        settings: {
          database: { enabled: true },
          file: false,
          mode: "json",
        },
      }),
    ).toThrow("requires an adapter");
  });
});

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

describe("DatabaseTransport retry backoff", () => {
  test("a failed batch waits out the backoff instead of retrying on the next trigger", async () => {
    const calls: string[][] = [];
    let failFirstCall = true;
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          calls.push(entries.map((item) => item.message));
          if (failFirstCall) {
            failFirstCall = false;
            throw new Error("boom");
          }
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
      retry: { backoff: "fixed", baseMs: 30 },
    });

    transport.write(entry("delayed"));
    await Promise.resolve();
    expect(calls).toEqual([["delayed"]]);

    // A fresh trigger while the backoff is due must not redeliver the batch.
    transport.writeBatch([]);
    expect(calls).toHaveLength(1);
    expect(transport.stats().queued).toBe(1);

    await sleep(150);
    expect(calls).toEqual([["delayed"], ["delayed"]]);
    expect(transport.stats().queued).toBe(0);
    await transport.close();
  });

  test("a successful write resets the attempt counter for later failures", async () => {
    const calls: string[][] = [];
    const delivered: string[] = [];
    let failureMode: "first" | "second" | null = "first";
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          calls.push(entries.map((item) => item.message));
          if (failureMode !== null) {
            const mode = failureMode;
            failureMode = mode === "first" ? "second" : null;
            throw new Error(`fail ${mode}`);
          }
          for (const item of entries) delivered.push(item.message);
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
      retry: { backoff: "fixed", baseMs: 20 },
    });

    transport.write(entry("one"));
    transport.write(entry("two"));
    await sleep(200);

    // Each transient failure gets a fresh unlimited attempt budget.
    expect(delivered).toEqual(["one", "two"]);
    expect(calls).toHaveLength(4);
    await transport.close();
  });

  test("exhausted attempts drop the batch and count it as dropped", async () => {
    let calls = 0;
    const delivered: string[] = [];
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          calls += 1;
          if (calls <= 2) throw new Error("still down");
          for (const item of entries) delivered.push(item.message);
        },
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
      retry: { attempts: 2, backoff: "fixed", baseMs: 15 },
    });

    transport.write(entry("lost"));
    await sleep(150);
    expect(transport.stats().dropped).toBe(1);
    expect(transport.stats().queued).toBe(0);
    expect(calls).toBe(2);

    // The queue keeps flowing after a dropped batch.
    transport.write(entry("kept"));
    await sleep(80);
    expect(delivered).toEqual(["kept"]);
    await transport.close();
  });

  test("close drains immediately and ignores a pending backoff wait", async () => {
    const calls: string[][] = [];
    let failFirstCall = true;
    const transport = new DatabaseTransport(
      {
        adapter: {
          write(entries) {
            calls.push(entries.map((item) => item.message));
            if (failFirstCall) {
              failFirstCall = false;
              throw new Error("boom");
            }
          },
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        retry: { backoff: "fixed", baseMs: 60_000 },
      },
      { write() {} },
    );

    transport.write(entry("shutdown"));
    await Promise.resolve();
    expect(calls).toEqual([["shutdown"]]);

    const startedAt = Date.now();
    await transport.close();
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(calls).toEqual([["shutdown"], ["shutdown"]]);
  });
});

describe("DatabaseTransport retry notices", () => {
  test("a failed batch emits an attempt notice to the sibling transport", async () => {
    const notices: LogEntry[] = [];
    let calls = 0;
    const transport = new DatabaseTransport(
      {
        adapter: {
          write() {
            calls += 1;
            if (calls === 1) throw new Error("disk full");
          },
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        retry: { backoff: "fixed", baseMs: 20 },
      },
      {
        write: (notice) => {
          notices.push(notice);
        },
      },
    );

    transport.write(entry("watched"));
    await sleep(150);

    expect(notices).toHaveLength(1);
    const notice = notices[0] as LogEntry;
    expect(notice.author).toBe("database");
    expect(notice.level).toBe("debug");
    expect(notice.message).toContain("retrying in");
    expect(notice.message).toContain("attempt 1/5");
    expect(notice.message).toContain("disk full");
    expect(notice.context.attempt).toBe(1);
    expect(notice.context.attempts).toBe(5);
    expect(typeof notice.context.waitMs).toBe("number");
    await transport.close();
  });

  test("exhausted attempts emit a drop warning with the dropped count", async () => {
    const notices: LogEntry[] = [];
    let calls = 0;
    const transport = new DatabaseTransport(
      {
        adapter: {
          write() {
            calls += 1;
            throw new Error("still down");
          },
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        retry: { attempts: 2, backoff: "fixed", baseMs: 15 },
      },
      {
        write: (notice) => {
          notices.push(notice);
        },
      },
    );

    transport.write(entry("doomed"));
    await sleep(150);

    const drop = notices.find((item) => item.level === "warn") as LogEntry | undefined;
    expect(drop?.author).toBe("database");
    expect(drop?.message).toContain("dropped after 2/2 attempts");
    expect(drop?.message).toContain("still down");
    expect(drop?.context.dropped).toBe(1);
    expect(transport.stats().dropped).toBe(1);
    expect(calls).toBe(2);
  });

  test("entries authored by the database transport never re-enter its queue", () => {
    const transport = new DatabaseTransport({
      adapter: { write() {} },
      enabled: true,
      flushInterval: 60_000,
    });

    transport.write({
      author: "database",
      context: {},
      level: "debug",
      message: "loop attempt",
      timestamp: "2026-08-24T00:00:00.000Z",
    });
    expect(transport.stats().queued).toBe(0);
  });

  test("the default pipeline wires database notices into console and file transports", async () => {
    const logger = createLogger({
      settings: {
        database: {
          // A dead adapter makes every batch fail and drop after one attempt.
          adapter: {
            write() {
              throw new Error("dead adapter");
            },
          },
          enabled: true,
          maxBufferSize: 1,
          retry: { attempts: 1, backoff: "fixed", baseMs: 10 },
        },
        file: false,
        mode: "json",
      },
    });

    const outputs: string[] = [];
    const capture = (value: unknown): void => {
      outputs.push(String(value));
    };
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = capture;
    console.warn = capture;
    try {
      // attempts: 1 drops the first batch immediately and warns through the tap.
      logger.info("will be dropped");
      await Bun.sleep(80);
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      await withMutedConsole(async () => {
        await logger.close();
      });
    }

    expect(outputs.some((line) => line.includes("database") && line.includes("dropped"))).toBe(
      true,
    );
  });
});
