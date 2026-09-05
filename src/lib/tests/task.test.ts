import { describe, expect, test } from "bun:test";

import { captureLogger } from "./test.transport.js";
import type { LogEntry } from "../../types/logger.js";

describe("logger.task", () => {
  test("manual form logs started and done with duration", () => {
    const { entries, logger } = captureLogger({ level: "debug", mode: "json" });

    const task = logger.task("uploading");
    task.done();

    expect(entries).toHaveLength(2);
    const [started, done] = entries as [LogEntry, LogEntry];
    expect(started.level).toBe("debug");
    expect(started.message).toBe("uploading started");
    expect(started.context.status).toBe("started");
    expect(started.context.task).toBe("uploading");

    expect(done.level).toBe("success");
    expect(done.message).toMatch(/^uploading done in \d+(?:\.\d+)?m?s$/u);
    expect(done.context.status).toBe("done");
    expect(done.context.durationMs).toBeNumber();
    expect(typeof done.context.spanId).toBe("string");
  });

  test("done after ended is a no-op", () => {
    const { entries, logger } = captureLogger({ level: "debug" });

    const task = logger.task("once-only");
    task.done();
    task.done();
    task.fail(new Error("late"));

    expect(entries).toHaveLength(2);
  });

  test("fail with an Error logs the error entry with the cause message", () => {
    const { entries, logger } = captureLogger({ level: "debug" });

    const task = logger.task("sync");
    task.fail(new Error("disk full"));

    const [failed] = entries.slice(-1) as [LogEntry];
    expect(failed.level).toBe("error");
    expect(failed.message).toBe("sync failed in 0ms - disk full");
    expect(failed.context.status).toBe("failed");
    expect((failed.context.error as Error).message).toBe("disk full");
  });

  test("fail with a string appends the detail without an error object", () => {
    const { entries, logger } = captureLogger({ level: "debug" });

    const task = logger.task("connect");
    task.fail("timeout");

    const failed = entries[1] as LogEntry;
    expect(failed.message).toBe("connect failed in 0ms - timeout");
    expect(failed.context.error).toBeUndefined();
  });

  test("callback form auto-completes and nests child entries under the group", async () => {
    const { entries, logger } = captureLogger({ level: "debug" });

    const result = await logger.task("query", async (task) => {
      logger.info("chunk sent");
      task.update("50%");
      return 42;
    });

    expect(result).toBe(42);
    expect(entries.map((item) => item.message)).toEqual([
      "query started",
      "chunk sent",
      "query done in 0ms",
    ]);

    const child = entries[1] as LogEntry;
    expect(child.context.group).toBe("query.");
    expect(typeof child.context.traceId).toBe("string");

    // The start line sits at the outer level, children indent under it.
    expect((entries[0] as LogEntry).context.group).toBe("query");
  });

  test("callback form marks the task failed and rethrows", async () => {
    const { entries, logger } = captureLogger({ level: "debug" });
    const boom = new Error("exploded");

    await expect(
      logger.task("risky", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const failed = entries[1] as LogEntry;
    expect(failed.level).toBe("error");
    expect(failed.message).toContain("risky failed in");
    expect(failed.message).toContain("exploded");
  });

  test("update() is silent by default and logs when progress is enabled", async () => {
    const off = captureLogger({ level: "debug" });
    const on = captureLogger({ level: "debug", task: { progress: true } });

    await off.logger.task("a", async (task) => {
      task.update("step 1");
    });
    await on.logger.task("b", async (task) => {
      task.update("step 1");
    });

    expect(off.entries.map((item) => item.message)).toEqual(["a started", "a done in 0ms"]);
    expect(on.entries).toHaveLength(3);
    expect(on.entries[1]?.message).toBe("step 1");
    expect(on.entries[1]?.level).toBe("debug");
  });

  test("progress entries carry an incrementing frame counter for spinner tokens", async () => {
    const { entries, logger } = captureLogger({
      level: "debug",
      task: { progress: true },
    });

    await logger.task("spin", async (task) => {
      task.update("one");
      task.update("two");
      task.update("three");
    });

    const frames = entries
      .filter((item) => item.context.status === "progress")
      .map((item) => item.context.frame);
    expect(frames).toEqual([0, 1, 2]);
    // Final done entry carries no frame.
    expect(entries.at(-1)?.context.frame).toBeUndefined();
  });

  test("tasks register spans so traceTree renders them", async () => {
    const { entries, logger } = captureLogger({ level: "debug" });

    await logger.task("traced", async () => {});
    logger.traceTree();

    const tree = entries.at(-1) as LogEntry;
    expect(tree.message).toContain("traced");
  });
});
