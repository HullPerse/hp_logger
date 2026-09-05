import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SPAN_PATH_MAX_DEPTH } from "../../config/logger.config.js";
import { createLogger } from "../../index.logger.js";
import { captureLogger, withMutedConsole } from "./test.transport.js";
import type { LogEntry } from "../../types/logger.js";
import { createSqliteAdapter } from "../../writer/sqlite.writer.js";

const lastEntry = (entries: LogEntry[]): LogEntry => entries.at(-1) as LogEntry;

describe("mixin enrichment hook", () => {
  test("merges mixin fields into every entry", () => {
    const { entries, logger } = captureLogger({
      mixin: () => ({ requestId: "r1", tenant: "acme" }),
    });
    logger.info("hello", { page: 2 });

    const entry = lastEntry(entries);
    expect(entry.context.requestId).toBe("r1");
    expect(entry.context.tenant).toBe("acme");
    expect(entry.context.page).toBe(2);
  });

  test("explicit call-site context wins over mixin fields", () => {
    const { entries, logger } = captureLogger({ mixin: () => ({ requestId: "from-mixin" }) });
    logger.info("hello", { requestId: "from-call" });

    expect(lastEntry(entries).context.requestId).toBe("from-call");
  });

  test("async-local context wins over mixin fields", async () => {
    const { entries, logger } = captureLogger({ mixin: () => ({ requestId: "from-mixin" }) });
    await logger.withContext({ requestId: "from-scope" }, async () => {
      logger.info("inside scope");
    });

    expect(lastEntry(entries).context.requestId).toBe("from-scope");
  });

  test("static logger context wins over mixin fields", () => {
    const { entries, logger, transport } = captureLogger({
      mixin: () => ({ region: "from-mixin" }),
    });
    const scoped = logger.child({ region: "eu-1" });
    scoped.transport = transport;
    scoped.info("hello");

    expect(lastEntry(entries).context.region).toBe("eu-1");
  });

  test("a throwing mixin contributes nothing and the entry still logs", () => {
    const { entries, logger } = captureLogger({
      mixin: () => {
        throw new Error("broken enrichment");
      },
    });
    logger.error("still here");

    const entry = lastEntry(entries);
    expect(entry.message).toBe("still here");
    expect(entry.level).toBe("error");
  });

  test("mixin output passes through redaction like any context", () => {
    const { entries, logger } = captureLogger({ mixin: () => ({ password: "hunter2" }) });
    logger.info("login");

    expect(lastEntry(entries).context.password).toBe("[REDACTED]");
  });

  test("module loggers inherit the mixin and receive their own author", () => {
    const { entries, logger, transport } = captureLogger({
      mixin: (ctx, level) => ({ lvl: level }),
    });
    const auth = logger.module("auth");
    auth.transport = transport;
    auth.warn("token expired");

    const entry = lastEntry(entries);
    expect(entry.author).toBe("auth");
    expect(entry.context.lvl).toBe("warn");
  });

  test("a runtime settings patch installs the mixin", () => {
    const { entries, logger, transport } = captureLogger({});
    logger.settings({ mixin: () => ({ injected: true }) });
    // settings() rebuilds the transport stack from settings; point it back
    // at the capture transport so the entry is observable.
    logger.transport = transport;
    logger.info("after patch");

    expect(lastEntry(entries).context.injected).toBe(true);
  });
});

describe("span path propagation", () => {
  test("entries inside nested callback spans carry the root-to-leaf path", async () => {
    const { entries, logger } = captureLogger({});
    await logger.span("outer", async () => {
      await logger.span("inner", async () => {
        logger.info("deep");
      });
    });

    const entry = entries.find((candidate) => candidate.message === "deep") as LogEntry;
    expect(entry.spanPath).toEqual(["outer", "inner"]);
  });

  test("every level inside a span carries the path, not only errors", async () => {
    const { entries, logger } = captureLogger({ level: "debug" });
    await logger.span("op", async () => {
      logger.debug("verbose");
      logger.error("boom");
    });

    const debugEntry = entries.find((entry) => entry.message === "verbose") as LogEntry;
    const errorEntry = entries.find((entry) => entry.message === "boom") as LogEntry;
    expect(debugEntry.spanPath).toEqual(["op"]);
    expect(errorEntry.spanPath).toEqual(["op"]);
  });

  test("entries outside spans carry no spanPath key", () => {
    const { entries, logger } = captureLogger({});
    logger.info("outside");

    expect(lastEntry(entries).spanPath).toBeUndefined();
  });

  test("a failed task callback carries the task span path", async () => {
    const { entries, logger } = captureLogger({});
    // The rejection is the expected failure signal; the entries matter here.
    try {
      await withMutedConsole(async () => {
        await logger.task("job", async () => {
          throw new Error("nope");
        });
      });
    } catch {
      // Expected: the task rethrows after logging the failure.
    }

    const failed = entries.findLast((entry) => entry.context.status === "failed") as LogEntry;
    expect(failed.spanPath).toEqual(["job"]);
  });

  test("the span path truncates at the depth cap", async () => {
    const { entries, logger } = captureLogger({});
    const nest = async (depth: number): Promise<void> => {
      if (depth === 0) {
        logger.error("bottom");
        return;
      }
      await logger.span(`s${depth}`, async () => nest(depth - 1));
    };
    await nest(SPAN_PATH_MAX_DEPTH + 1);

    const entry = entries.find((candidate) => candidate.message === "bottom") as LogEntry;
    expect(entry.spanPath?.length).toBe(SPAN_PATH_MAX_DEPTH);
    expect(entry.spanPath?.[0]).toBe(`s${SPAN_PATH_MAX_DEPTH + 1}`);
  });

  test("the manual span form does not add a span path", () => {
    const { entries, logger } = captureLogger({});
    const span = logger.span("manual");
    logger.info("during manual span");
    span.end();

    expect(lastEntry(entries).spanPath).toBeUndefined();
  });

  test("redaction leaves the span path intact while masking context arrays", async () => {
    const { entries, logger } = captureLogger({});
    await logger.span("op", async () => {
      logger.info("with list", { tags: ["a", "b"] });
    });

    const entry = entries.find((candidate) => candidate.message === "with list") as LogEntry;
    expect(entry.context.tags).toBe("[2 items]");
    expect(entry.spanPath).toEqual(["op"]);
  });
});

describe("schema version stamping", () => {
  test("json file lines carry v:1 when enabled and nothing when disabled", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hp_logger_wave_h_"));
    const writeLine = async (schemaVersion: boolean): Promise<Record<string, unknown>> => {
      const logfile = path.join(dir, `log_${String(schemaVersion)}.log`);
      const logger = createLogger({
        settings: {
          file: { enabled: true, path: logfile, rotation: "none" },
          mode: "json",
          schemaVersion,
        },
      });
      await withMutedConsole(async () => {
        logger.info("versioned");
        await logger.close();
      });
      return JSON.parse(readFileSync(logfile, "utf-8").trim()) as Record<string, unknown>;
    };
    try {
      const on = await writeLine(true);
      expect(on.v).toBe(1);
      const off = await writeLine(false);
      expect("v" in off).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("console json output includes v when enabled", () => {
    const calls: string[] = [];
    const originalLog = console.log;
    console.log = (line: string): void => {
      calls.push(line);
    };
    try {
      const logger = createLogger({ settings: { mode: "json", schemaVersion: true } });
      logger.info("on console");
    } finally {
      console.log = originalLog;
    }
    const parsed = JSON.parse(calls.at(-1) as string) as Record<string, unknown>;
    expect(parsed.v).toBe(1);
  });

  test("a fresh table with schemaVersion writes version rows", async () => {
    const db = new Database(":memory:");
    const adapter = createSqliteAdapter(db, { schemaVersion: true, table: "logs" });
    const logger = createLogger({ settings: { database: { adapter, enabled: true } } });
    await withMutedConsole(async () => {
      logger.info("row");
      await logger.close();
    });

    const rows = db.query("SELECT version FROM logs").all() as { version: number }[];
    expect(rows.map((row) => row.version)).toEqual([1]);
  });

  test("an old table without the column fails clearly under schemaVersion", () => {
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
    expect(() => createSqliteAdapter(db, { schemaVersion: true })).toThrow(
      /missing columns: version.*ALTER TABLE/su,
    );
  });

  test("an old table keeps working without the option", async () => {
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
      logger.info("legacy row");
      await logger.close();
    });

    const rows = db.query("SELECT message FROM logs").all() as { message: string }[];
    expect(rows.map((row) => row.message)).toEqual(["legacy row"]);
  });

  test("a versioned table also accepts writers without the option", async () => {
    const db = new Database(":memory:");
    const versioned = createSqliteAdapter(db, { schemaVersion: true, table: "logs" });
    versioned.close?.();

    const logger = createLogger({
      settings: { database: { adapter: createSqliteAdapter(db), enabled: true } },
    });
    await withMutedConsole(async () => {
      logger.info("unversioned writer on versioned table");
      await logger.close();
    });

    const rows = db.query("SELECT message, version FROM logs").all() as {
      message: string;
      version: number;
    }[];
    expect(rows[0]?.message).toBe("unversioned writer on versioned table");
    expect(rows[0]?.version).toBe(1);
  });
});
