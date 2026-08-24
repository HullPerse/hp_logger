import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { withMutedConsole } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import { DatabaseTransport } from "@/writer/database.writer";
import { FileTransport } from "@/writer/file.writer";

const entry = (message: string): LogEntry => ({
  author: "TEST",
  context: {},
  level: "info",
  message,
  timestamp: "2026-08-24T00:00:00.000Z",
});

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

const workdir = mkdtempSync(path.join(tmpdir(), "hp-recovery-"));

describe("DatabaseTransport self-healing", () => {
  test("a dead adapter is rebuilt and the backlog drains to the new one", async () => {
    const notices: LogEntry[] = [];
    const rows: string[] = [];
    let builds = 0;
    let closedAdapters = 0;
    const transport = new DatabaseTransport(
      {
        // First adapter always fails; the factory rebuilds a healthy one.
        adapter: {
          close: () => {
            closedAdapters += 1;
          },
          write() {
            throw new Error("connection lost");
          },
        },
        createAdapter: () => {
          builds += 1;
          return {
            write(entries) {
              for (const item of entries) rows.push(item.message);
            },
          };
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        reconnect: { cooldownMs: 20 },
        retry: { attempts: 1, backoff: "fixed", baseMs: 5 },
      },
      {
        write: (notice) => {
          notices.push(notice);
        },
      },
    );

    transport.write(entry("survivor"));
    await sleep(150);

    // The backlog drained into the rebuilt adapter.
    expect(rows).toEqual(["survivor"]);
    expect(builds).toBe(1);
    expect(closedAdapters).toBe(1);
    expect(transport.stats().dropped).toBe(0);
    const kinds = notices.map((item) => `${item.level}:${item.message.slice(0, 20)}`);
    expect(kinds.some((item) => item.startsWith("warn:adapter down"))).toBe(true);
    expect(kinds.some((item) => item.startsWith("info:adapter recover"))).toBe(true);

    // The healed transport keeps writing.
    transport.write(entry("post-recovery"));
    await sleep(60);
    expect(rows).toEqual(["survivor", "post-recovery"]);
    await transport.close();
  });

  test("reconnect gives up after maxAttempts and drops the backlog", async () => {
    const notices: LogEntry[] = [];
    let builds = 0;
    const transport = new DatabaseTransport(
      {
        adapter: {
          write() {
            throw new Error("still dead");
          },
        },
        createAdapter: () => {
          builds += 1;
          return {
            write() {
              throw new Error("rebuild is dead too");
            },
          };
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        reconnect: { cooldownMs: 15, maxAttempts: 2 },
        retry: { attempts: 1, backoff: "fixed", baseMs: 5 },
      },
      {
        write: (notice) => {
          notices.push(notice);
        },
      },
    );

    transport.write(entry("lost"));
    await sleep(200);

    expect(builds).toBe(2);
    expect(transport.stats().dropped).toBe(1);
    const giveUp = notices.find((item) => item.message.includes("rebuild failed")) as
      | LogEntry
      | undefined;
    expect(giveUp?.level).toBe("warn");
    expect(giveUp?.context.dropped).toBe(1);
    await transport.close();
  });

  test("close() during recovery resolves without hanging", async () => {
    const transport = new DatabaseTransport({
      adapter: {
        write() {
          throw new Error("down");
        },
      },
      createAdapter: () => {
        throw new Error("cannot rebuild");
      },
      enabled: true,
      flushInterval: 60_000,
      maxBufferSize: 1,
      reconnect: { cooldownMs: 60_000 },
      retry: { attempts: 1, backoff: "fixed", baseMs: 5 },
    });

    transport.write(entry("shutdown"));
    await sleep(30);
    const startedAt = Date.now();
    await transport.close();
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("without createAdapter, exhaustion keeps the legacy drop behavior", async () => {
    const notices: LogEntry[] = [];
    let calls = 0;
    const transport = new DatabaseTransport(
      {
        adapter: {
          write() {
            calls += 1;
            throw new Error("no factory here");
          },
        },
        enabled: true,
        flushInterval: 60_000,
        maxBufferSize: 1,
        retry: { attempts: 2, backoff: "fixed", baseMs: 10 },
      },
      {
        write: (notice) => {
          notices.push(notice);
        },
      },
    );

    transport.write(entry("dropped"));
    await sleep(120);
    expect(transport.stats().dropped).toBe(1);
    expect(calls).toBe(2);
    expect(notices.some((item) => item.message.includes("reconnect"))).toBe(false);
    await transport.close();
  });
});

describe("FileTransport stream self-healing", () => {
  test("a failed flush re-opens a fresh stream on the next flush", async () => {
    const dir = path.join(workdir, "file-heal");
    mkdirSync(dir, { recursive: true });
    const goodPath = path.join(dir, "ok.log");

    class FlakyPathTransport extends FileTransport {
      private flips = 0;

      protected override targetFilepath(): string {
        this.flips += 1;
        // First flush targets a directory so the stream errors on open.
        return this.flips === 1 ? dir : goodPath;
      }
    }

    await withMutedConsole(async () => {
      const transport = new FlakyPathTransport(path.join(dir, "app.log"), {
        contextFormat: "json",
        path: dir,
      });
      // First flush targets the directory itself: the stream fails to open,
      // the error listener destroys it and the next flush re-opens fresh.
      transport.write(entry("first try fails"));
      await transport.flush();
      // The open error lands asynchronously; give it a beat to null the stream.
      await sleep(30);

      transport.write(entry("second try heals"));
      await transport.flush();
      await transport.close();
    });

    expect(existsSync(goodPath)).toBe(true);
    expect(readFileSync(goodPath, "utf-8")).toContain("second try heals");
  });
});

describe("recovery cleanup", () => {
  test("removes the temp workdir", () => {
    rmSync(workdir, { force: true, recursive: true });
    expect(existsSync(workdir)).toBe(false);
  });
});
