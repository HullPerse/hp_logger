import { describe, expect, test } from "bun:test";
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLogger, Logger } from "@/index.logger";
import { captureLogger, withMutedConsole } from "@/lib/tests/test.transport";
import type { LogEntry, LogLevel } from "@/types/logger";
import type { Transport } from "@/types/transport";
import { DateBasedFileTransport } from "@/writer/dateBased.writer";
import { LeveledTransport } from "@/writer/leveled.writer";

const workdir = path.join(tmpdir(), `hp-split-${Date.now()}`);

const entry = (message: string, level: LogLevel = "info"): LogEntry => ({
  author: "TEST",
  context: {},
  level,
  message,
  timestamp: "2026-08-24T00:00:00.000Z",
});

describe("LeveledTransport", () => {
  test("min-level mode passes the level and everything above it", async () => {
    const seen: string[] = [];
    const gate = new LeveledTransport(
      {
        write: (e) => {
          seen.push(e.message);
        },
      },
      "warn",
    );

    gate.write(entry("debug noise", "debug"));
    gate.write(entry("warn here", "warn"));
    gate.write(entry("error there", "error"));

    expect(seen).toEqual(["warn here", "error there"]);
  });

  test("exact mode passes only the exact level", async () => {
    const seen: string[] = [];
    const gate = new LeveledTransport(
      {
        write: (e) => {
          seen.push(e.message);
        },
      },
      "error",
      true,
    );

    gate.write(entry("warn", "warn"));
    gate.write(entry("fatal", "fatal"));
    gate.write(entry("error", "error"));

    expect(seen).toEqual(["error"]);
    gate.writeBatch([entry("error-batch", "error"), entry("warn-batch", "warn")]);
    expect(seen).toEqual(["error", "error-batch"]);
  });
});

describe("addTransport level option", () => {
  test("a leveled global transport receives only its level and above", async () => {
    const seen: string[] = [];
    Logger.addTransport(
      {
        write: (e) => {
          seen.push(e.message);
        },
      },
      { level: "warn" },
    );
    const { logger } = captureLogger({ level: "debug", mode: "json" });

    logger.info("quiet");
    logger.warn("loud");
    logger.error("boom");

    expect(seen).toEqual(["loud", "boom"]);
    Logger.clearTransports();
  });

  test("removeTransport unwraps a leveled registration", () => {
    const seen: string[] = [];
    const target: Transport = {
      write: (e) => {
        seen.push(e.message);
      },
    };
    Logger.addTransport(target, { level: "error" });
    Logger.removeTransport(target);
    const { logger } = captureLogger({ level: "debug", mode: "json" });

    logger.error("ignored");

    expect(seen).toEqual([]);
    Logger.clearTransports();
  });
});

describe("splitByLevel files", () => {
  test("each level lands in its own suffixed file", async () => {
    const dir = path.join(workdir, "split");
    mkdirSync(dir, { recursive: true });
    const logger = createLogger({
      settings: {
        file: { enabled: true, path: path.join(dir, "app.log"), splitByLevel: true },
        mode: "json",
      },
    });

    await withMutedConsole(async () => {
      logger.info("hello info");
      logger.error("hello error");
      await logger.close();
    });

    const infoFile = path.join(dir, "app.info.log");
    const errorFile = path.join(dir, "app.error.log");
    expect(existsSync(infoFile)).toBe(true);
    expect(existsSync(errorFile)).toBe(true);
    expect(readFileSync(infoFile, "utf-8")).toContain("hello info");
    expect(readFileSync(errorFile, "utf-8")).toContain("hello error");
    expect(readFileSync(infoFile, "utf-8")).not.toContain("hello error");
  });

  test("daily rotation with splitByLevel uses the level as file prefix", async () => {
    const dir = path.join(workdir, "split-daily");
    const transport = new DateBasedFileTransport(dir, {
      contextFormat: "json",
      mode: "json",
      namePrefix: "error",
      path: dir,
    });
    transport.write(entry("daily error"));

    await transport.flush();
    await transport.close();

    // Daily rotation nests under a date directory.
    const dateDirs = readdirSync(dir);
    expect(dateDirs).toHaveLength(1);
    const dayDir = path.join(dir, dateDirs[0] as string);
    const files = readdirSync(dayDir);
    expect(files.some((f) => f.startsWith("error_") && f.endsWith(".log"))).toBe(true);
    expect(files.some((f) => f.startsWith("log_"))).toBe(false);
  });

  test("cleanup removes the temp workdir", () => {
    rmSync(workdir, { force: true, recursive: true });
    expect(existsSync(workdir)).toBe(false);
  });
});
