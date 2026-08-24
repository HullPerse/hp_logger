import { describe, expect, test } from "bun:test";

import type { LogEntry } from "@/types/logger";
import type { Transport } from "@/types/transport";
import { AsyncTransport } from "@/writer/buffer.writer";
import { MultiTransport } from "@/writer/group.writer";

const entry = (message: string): LogEntry => ({
  author: "ROOT",
  context: {},
  level: "info",
  message,
  timestamp: "2024-01-02 03:04:05",
});

describe("AsyncTransport", () => {
  test("uses writeBatch when the wrapped transport provides it", async () => {
    const batched: LogEntry[][] = [];
    const transport: Transport = {
      write() {
        throw new Error("write should not be called when writeBatch exists");
      },
      writeBatch(entries: LogEntry[]) {
        batched.push([...entries]);
      },
    };

    const asyncTransport = new AsyncTransport(transport, { batchSize: 2 });
    const p1 = asyncTransport.write(entry("a"));
    const p2 = asyncTransport.write(entry("b"));
    await p1;
    await p2;
    await asyncTransport.close();

    expect(batched.length).toBeGreaterThan(0);
    expect(batched.flat()).toEqual([entry("a"), entry("b")]);
  });

  test("falls back to write() when writeBatch is missing", async () => {
    const written: LogEntry[] = [];
    const transport: Transport = {
      write(logEntry: LogEntry) {
        written.push(logEntry);
      },
    };

    const asyncTransport = new AsyncTransport(transport, { batchSize: 2 });
    await asyncTransport.write(entry("x"));
    await asyncTransport.write(entry("y"));
    await asyncTransport.close();

    expect(written).toEqual([entry("x"), entry("y")]);
  });

  test("close waits for an in-flight batch before draining later entries", async () => {
    const writes: LogEntry[][] = [];
    const firstBatchFinished = Promise.withResolvers<null>();
    const transport: Transport = {
      write() {
        throw new Error("write should not be called when writeBatch exists");
      },
      async writeBatch(entries: LogEntry[]) {
        writes.push([...entries]);
        if (writes.length === 1) await firstBatchFinished.promise;
      },
    };

    const asyncTransport = new AsyncTransport(transport, { batchSize: 10 });
    const firstWrite = asyncTransport.write(entry("first"));
    await Promise.resolve();
    const secondWrite = asyncTransport.write(entry("second"));
    const closing = asyncTransport.close();
    await Promise.resolve();

    expect(writes).toEqual([[entry("first")]]);
    firstBatchFinished.resolve(null);
    await Promise.all([firstWrite, secondWrite, closing]);
    expect(writes).toEqual([[entry("first")], [entry("second")]]);
  });

  test("close closes the wrapped transport once when called repeatedly", async () => {
    let closeCalls = 0;
    const asyncTransport = new AsyncTransport({
      close() {
        closeCalls += 1;
      },
      write() {},
    });

    await Promise.all([asyncTransport.close(), asyncTransport.close()]);
    const afterClose = asyncTransport.write(entry("after close"));
    await afterClose;

    expect(closeCalls).toBe(1);
    expect(asyncTransport.stats()).toEqual({ dropped: 1, queued: 0, transportErrors: 0 });
  });

  test("drops newest entries at the queue limit and resolves their writes", async () => {
    const written: LogEntry[] = [];
    const transport: Transport = {
      write(logEntry: LogEntry) {
        written.push(logEntry);
      },
    };
    const asyncTransport = new AsyncTransport(transport, {
      batchSize: 10,
      maxQueueSize: 2,
    });

    const first = asyncTransport.write(entry("first"));
    const second = asyncTransport.write(entry("second"));
    const dropped = asyncTransport.write(entry("dropped"));

    expect(asyncTransport.stats()).toEqual({
      dropped: 1,
      queued: 2,
      transportErrors: 0,
    });
    await dropped;
    await asyncTransport.close();
    await Promise.all([first, second]);

    expect(written).toEqual([entry("first"), entry("second")]);
    expect(asyncTransport.stats().dropped).toBe(1);
  });

  test("counts a failed batch and continues with later entries", async () => {
    const batches: LogEntry[][] = [];
    let failures = 1;
    const asyncTransport = new AsyncTransport(
      {
        write() {
          throw new Error("write should not be called when writeBatch exists");
        },
        writeBatch(entries: LogEntry[]) {
          batches.push([...entries]);
          if (failures > 0) {
            failures -= 1;
            throw new Error("temporary sink failure");
          }
        },
      },
      { batchSize: 1 },
    );

    const first = asyncTransport.write(entry("failed"));
    const second = asyncTransport.write(entry("continued"));
    await Promise.all([first, second]);
    await asyncTransport.close();

    expect(batches).toEqual([[entry("failed")], [entry("continued")]]);
    expect(asyncTransport.stats()).toEqual({
      dropped: 0,
      queued: 0,
      transportErrors: 1,
    });
  });

  test("close drains the remaining queue via writeBatch", async () => {
    const batches: LogEntry[][] = [];
    const transport: Transport = {
      write() {
        throw new Error("write should not be called when writeBatch exists");
      },
      writeBatch(entries: LogEntry[]) {
        batches.push([...entries]);
      },
    };

    const asyncTransport = new AsyncTransport(transport, { batchSize: 100 });
    const p = asyncTransport.write(entry("only"));
    await asyncTransport.close();
    await p;

    expect(batches).toEqual([[entry("only")]]);
  });
});

describe("MultiTransport", () => {
  test("routes a batch to writeBatch when the child provides it", async () => {
    const batched: LogEntry[][] = [];
    const transport = new MultiTransport([
      {
        write() {
          throw new Error("write should not be called when writeBatch exists");
        },
        writeBatch(entries: LogEntry[]) {
          batched.push([...entries]);
        },
      },
    ]);

    await transport.writeBatch([entry("a"), entry("b")]);

    expect(batched).toEqual([[entry("a"), entry("b")]]);
  });

  test("falls back to per-entry write for children without writeBatch", async () => {
    const written: LogEntry[] = [];
    const transport = new MultiTransport([
      {
        write(logEntry: LogEntry) {
          written.push(logEntry);
        },
      },
    ]);

    await transport.writeBatch([entry("a"), entry("b")]);

    // The batch is delivered entry by entry instead of being dropped.
    expect(written).toEqual([entry("a"), entry("b")]);
  });

  test("aggregates observable stats from child transports", () => {
    const transport = new MultiTransport([
      {
        stats: () => ({ dropped: 2, queued: 3, transportErrors: 1 }),
        write() {},
      },
      {
        stats: () => ({ dropped: 4, queued: 5, transportErrors: 6 }),
        write() {},
      },
    ]);

    expect(transport.stats()).toEqual({ dropped: 6, queued: 8, transportErrors: 7 });
  });
});
