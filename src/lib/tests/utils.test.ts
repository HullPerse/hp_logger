import { describe, expect, test } from "bun:test";

import { attempt, attemptAsync } from "../result.utils.js";
import { dispatchBatch } from "../transport.utils.js";
import type { LogEntry } from "../../types/logger.js";
import type { Transport } from "../../types/transport.js";

const entry = (message: string): LogEntry => ({
  author: "ROOT",
  context: {},
  level: "info",
  message,
  timestamp: "2026-08-24 10:00:00",
});

describe("dispatchBatch", () => {
  test("uses writeBatch when the boundary provides it", async () => {
    const batches: LogEntry[][] = [];
    const transport: Transport = {
      write() {
        throw new Error("single-entry path should not run");
      },
      writeBatch(entries) {
        batches.push(entries);
      },
    };

    await dispatchBatch(transport, [entry("a"), entry("b")]);
    expect(batches).toEqual([[entry("a"), entry("b")]]);
  });

  test("dispatches every entry when only write is available", async () => {
    const written: string[] = [];
    const transport: Transport = {
      async write(value) {
        await Promise.resolve();
        written.push(value.message);
      },
    };

    await dispatchBatch(transport, [entry("a"), entry("b")]);
    expect(written.toSorted()).toEqual(["a", "b"]);
  });
});

describe("attempt", () => {
  test("returns a value for a successful call", () => {
    expect(attempt(() => 42)).toEqual({ ok: true, value: 42 });
  });

  test("normalizes non-Error throws", () => {
    const result = attempt(() => {
      throw Symbol("failed");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual(new Error("Symbol(failed)"));
  });

  test("normalizes async rejections", async () => {
    const result = await attemptAsync(() => Promise.reject(new Error("rejected")));
    expect(result).toEqual({ error: new Error("rejected"), ok: false });
  });
});
