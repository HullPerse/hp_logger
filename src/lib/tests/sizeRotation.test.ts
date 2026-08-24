import { describe, expect, test } from "bun:test";
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { withMutedConsole } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import { SizeBasedFileTransport } from "@/writer/sizeBased.writer";

const entry = (message: string): LogEntry => ({
  author: "TEST",
  context: {},
  level: "info",
  message,
  timestamp: "2026-08-24T00:00:00.000Z",
});

const workdir = path.join(tmpdir(), `hp-size-rotation-${Date.now()}`);

const makeTransport = (name: string, options: { maxBytes: number; maxFiles?: number; gzip?: boolean }) => {
  const dir = path.join(workdir, name);
  mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, "app.log");
  const transport = new SizeBasedFileTransport(filepath, {
    contextFormat: "json",
    gzip: options.gzip,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
    mode: "json",
    path: dir,
  });
  return { dir, filepath, transport };
};

describe("SizeBasedFileTransport", () => {
  test("rotates the active file into segment 1 when maxBytes is exceeded", async () => {
    const { dir, transport } = makeTransport("basic", { maxBytes: 60 });

    await withMutedConsole(async () => {
      transport.write(entry("first-entry"));
      await transport.flush();
      transport.write(entry("second-entry"));
      await transport.flush();

      // Every flush here exceeds the tiny cap, so each one rotates:
      // the newest entry lands in segment 1, the first one in segment 2.
      const segment1 = readFileSync(path.join(dir, "app.1.log"), "utf-8");
      expect(segment1).toContain("second-entry");
      const segment2 = readFileSync(path.join(dir, "app.2.log"), "utf-8");
      expect(segment2).toContain("first-entry");
      await transport.close();
    });
  });

  test("keeps at most maxFiles segments", async () => {
    const { dir, transport } = makeTransport("retention", {
      maxBytes: 40,
      maxFiles: 2,
    });

    await withMutedConsole(async () => {
      for (const wave of ["w1", "w2", "w3", "w4"]) {
        for (let i = 0; i < 3; i += 1) transport.write(entry(`${wave}-${i}`));
        // Sequential on purpose: each wave must land before the next
        // rotation check, otherwise the waves interleave across segments.
        // eslint-disable-next-line no-await-in-loop
        await transport.flush();
      }
      await transport.close();
    });

    const files = readdirSync(dir).toSorted();
    expect(files).toEqual(["app.1.log", "app.2.log"]);
    // The newest surviving segment holds the fourth wave, the second one
    // the third; everything older fell off past maxFiles.
    expect(readFileSync(path.join(dir, "app.1.log"), "utf-8")).toContain("w4-0");
    expect(readFileSync(path.join(dir, "app.2.log"), "utf-8")).toContain("w3-0");
  });

  test("gzip mode stores segments compressed and removes the plain file", async () => {
    const { dir, transport } = makeTransport("gzip", { gzip: true, maxBytes: 40 });

    await withMutedConsole(async () => {
      for (let i = 0; i < 3; i += 1) transport.write(entry(`gz-${i}`));
      await transport.flush();
      // Compression is a background task; give it a moment.
      await Bun.sleep(80);
      await transport.close();
    });

    const gzPath = path.join(dir, "app.1.log.gz");
    expect(existsSync(gzPath)).toBe(true);
    expect(existsSync(path.join(dir, "app.1.log"))).toBe(false);
    const plain = gunzipSync(readFileSync(gzPath)).toString("utf-8");
    expect(plain).toContain("gz-0");
  });

  test("cleanup removes the temp workdir", () => {
    rmSync(workdir, { force: true, recursive: true });
    expect(existsSync(workdir)).toBe(false);
  });
});
