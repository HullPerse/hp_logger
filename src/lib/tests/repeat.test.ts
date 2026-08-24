import { describe, expect, test } from "bun:test";

import { RepeatTransport } from "@/writer/repeat.writer";
import type { LogEntry } from "@/types/logger";

const entry = (message: string, context: Record<string, unknown> = {}): LogEntry => ({
  author: "TEST",
  context,
  level: "error",
  message,
  timestamp: "2026-08-24 10:11:12",
});

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

const captured = (): { entries: LogEntry[]; transport: RepeatTransport } => {
  const entries: LogEntry[] = [];
  const transport = new RepeatTransport(
    {
      write: (item) => {
        entries.push(item);
      },
    },
    { windowMs: 20 },
  );
  return { entries, transport };
};

describe("RepeatTransport", () => {
  test("writes the first occurrence immediately and a summary on window close", async () => {
    const { entries, transport } = captured();
    transport.write(entry("connection failed"));
    transport.write(entry("connection failed"));
    transport.write(entry("connection failed"));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("connection failed");

    await sleep(50);

    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      context: { count: 3 },
      message: "connection failed ×3",
    });
    await transport.close();
  });

  test("distinct messages never merge", async () => {
    const { entries, transport } = captured();
    transport.write(entry("a"));
    transport.write(entry("b"));
    await sleep(50);
    expect(entries.map((item) => item.message)).toEqual(["a", "b"]);
    await transport.close();
  });

  test("errors group by message, name and first stack frame", async () => {
    const { entries, transport } = captured();
    const errorA = { message: "db down", name: "DatabaseError", stack: "DatabaseError: db down\n    at query (src/db.ts:5)" };
    const errorB = { message: "db down", name: "DatabaseError", stack: "DatabaseError: db down\n    at query (src/db.ts:5)" };
    const errorC = { message: "db down", name: "DatabaseError", stack: "DatabaseError: db down\n    at other (src/db.ts:9)" };

    transport.write(entry("boom", { error: errorA }));
    transport.write(entry("boom", { error: errorB }));
    transport.write(entry("boom", { error: errorC }));
    await sleep(50);

    expect(entries).toHaveLength(3);
    expect(entries[0]?.message).toBe("boom");
    expect(entries[1]?.message).toBe("boom");
    expect(entries[2]?.message).toBe("boom ×2");
    await transport.close();
  });

  test("flushes the oldest group when maxKeys is exceeded", async () => {
    const entries: LogEntry[] = [];
    const transport = new RepeatTransport(
      {
        write: (item) => {
          entries.push(item);
        },
      },
      { maxKeys: 2, windowMs: 60_000 },
    );
    transport.write(entry("first"));
    transport.write(entry("first"));
    transport.write(entry("second"));
    transport.write(entry("third"));

    // Duplicates are not re-written; the overflowing least-recently-used
    // group (first, which only received a duplicate) is evicted and its
    // summary is flushed.
    expect(entries.map((item) => item.message)).toEqual([
      "first",
      "second",
      "third",
      "first ×2",
    ]);
    await transport.close();
  });

  test("close flushes pending summaries", async () => {
    const { entries, transport } = captured();
    transport.write(entry("keep"));
    transport.write(entry("keep"));
    await transport.close();
    expect(entries.map((item) => item.message)).toEqual(["keep", "keep ×2"]);
  });
});