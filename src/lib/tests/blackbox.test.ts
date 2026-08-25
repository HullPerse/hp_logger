import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLogger, installErrorHandlers } from "@/index.logger";
import { captureLogger } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import type { Transport } from "@/types/transport";
import { AsyncTransport } from "@/writer/buffer.writer";

const workdir = mkdtempSync(path.join(tmpdir(), "hp-blackbox-"));

describe("black box", () => {
  test("records entries into the ring and caps it at the configured size", () => {
    const { logger } = captureLogger({ blackbox: { size: 3 }, level: "debug" });

    logger.info("one");
    logger.info("two");
    logger.info("three");
    logger.info("four");

    const tmpFile = path.join(workdir, "ring.jsonl");
    return logger.dump(tmpFile).then((written) => {
      expect(written).toBe(tmpFile);
      const lines = readFileSync(tmpFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines.map((line) => (JSON.parse(line) as LogEntry).message)).toEqual([
        "two",
        "three",
        "four",
      ]);
    });
  });

  test("dump appends consecutive dumps to the same file", async () => {
    const { logger } = captureLogger({
      blackbox: { path: path.join(workdir, "append.jsonl") },
      level: "debug",
    });

    logger.info("first-wave");
    expect(await logger.dump()).toBe(path.join(workdir, "append.jsonl"));
    logger.info("second-wave");
    await logger.dump();

    const messages = readFileSync(path.join(workdir, "append.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as LogEntry).message);
    expect(messages).toEqual(["first-wave", "second-wave"]);
  });

  test("disabled by default: dump writes nothing and returns null", async () => {
    const { logger } = captureLogger({ level: "debug" });

    logger.info("not recorded");
    const target = path.join(workdir, "should-not-exist.jsonl");
    expect(await logger.dump(target)).toBeNull();
    expect(existsSync(target)).toBe(false);
  });

  test("dump without any path flushes but writes no file", async () => {
    const { logger } = captureLogger({ blackbox: { size: 5 }, level: "debug" });

    logger.info("ring only");
    expect(await logger.dump()).toBeNull();
  });

  test("flush() delivers pending batching entries and keeps the logger usable", async () => {
    const written: string[] = [];
    const inner: Transport = {
      write: (entry) => {
        written.push(entry.message);
      },
    };
    const { logger } = captureLogger({ level: "debug" });
    logger.transport = new AsyncTransport(inner, { batchSize: 10 });

    logger.info("pending");
    expect(written).toEqual([]);
    await logger.flush();
    expect(written).toEqual(["pending"]);

    // A flushed logger keeps logging.
    logger.info("after flush");
    await logger.flush();
    expect(written).toEqual(["pending", "after flush"]);
  });

  test("blackbox can be enabled at runtime through settings()", async () => {
    const { logger } = captureLogger({ level: "debug" });
    logger.info("before enable");

    logger.settings({ blackbox: { size: 5 } });
    logger.info("after enable");

    const target = path.join(workdir, "runtime.jsonl");
    expect(await logger.dump(target)).toBe(target);
    const messages = readFileSync(target, "utf-8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as LogEntry).message);
    expect(messages).toEqual(["after enable"]);
  });
});

describe("crash handlers", () => {
  test("crashes dump the black box, flush transports and log both event kinds", async () => {
    const dumpPath = path.join(workdir, "crash.jsonl");
    let flushes = 0;
    const captured: LogEntry[] = [];
    const logger = createLogger({
      settings: {
        blackbox: { path: dumpPath, size: 10 },
        level: "debug",
        mode: "json",
      },
    });
    logger.transport = {
      flush: () => {
        flushes += 1;
      },
      write: (entry) => {
        captured.push(entry);
      },
    };

    // The module installs global handlers once per process: one install
    // covers both event kinds.
    installErrorHandlers(logger);
    logger.info("before crash");
    process.emit("uncaughtException", new Error("boom")) as boolean;
    await Bun.sleep(60);

    expect(flushes).toBeGreaterThan(0);
    const messages = readFileSync(dumpPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as LogEntry).message);
    expect(messages).toContain("before crash");
    expect(messages).toContain("uncaughtException");
    const crashEntry = captured.find((item) => item.message === "uncaughtException");
    const crashError = crashEntry === undefined ? undefined : crashEntry.context.error;
    expect((crashError as Error).message).toBe("boom");

    process.emit("unhandledRejection", new Error("rejected")) as boolean;
    await Bun.sleep(30);
    const rejection = captured.find((item) => item.message === "unhandledRejection");
    const rejectionError = rejection === undefined ? undefined : rejection.context.error;
    expect((rejectionError as Error).message).toBe("rejected");
  });
});

describe("black box cleanup", () => {
  test("removes the temp workdir", () => {
    rmSync(workdir, { force: true, recursive: true });
    expect(existsSync(workdir)).toBe(false);
  });
});
