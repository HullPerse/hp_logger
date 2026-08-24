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
