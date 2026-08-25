import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createLogServer, LogBuffer } from "@/http/log.server";
import type { LogEntry } from "@/types/logger";

const entry = (message: string, level: LogEntry["level"] = "info"): LogEntry => ({
  author: "test",
  context: { requestId: "abc" },
  level,
  message,
  timestamp: "2026-08-24 12:00:00",
});

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
});

describe("createLogServer", () => {
  let buffer: LogBuffer;
  let server: ReturnType<typeof createLogServer>;

  beforeAll(() => {
    buffer = new LogBuffer();
    server = createLogServer(buffer, { port: 0, token: "sekret" });
  });

  afterAll(() => {
    server.close();
  });

  test("serves the ring buffer over HTTP with cursor polling", async () => {
    buffer.transport.write(entry("hello"));
    const auth = { authorization: "Bearer sekret" };

    const firstResponse = await fetch(`${server.url}/hp_logger/logs`, { headers: auth });
    const first = (await firstResponse.json()) as {
      entries: { message: string }[];
      next: number;
    };
    expect(first.entries.map((item) => item.message)).toContain("hello");

    buffer.transport.write(entry("world"));
    const deltaResponse = await fetch(`${server.url}/hp_logger/logs?after=${first.next}`, {
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
    const response = await fetch(`${server.url}/nope`, {
      headers: { authorization: "Bearer sekret" },
    });
    expect(response.status).toBe(404);
  });
});
