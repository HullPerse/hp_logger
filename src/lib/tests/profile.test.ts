import { describe, expect, test } from "bun:test";

import { captureLogger } from "./test.transport.js";

describe("profiler aggregation", () => {
  test("time(), span() and task() durations feed one operation histogram", async () => {
    const { logger } = captureLogger({ level: "debug", mode: "json", profile: true });

    await logger.time("db", async () => {});
    const span = logger.span("render");
    span.end();
    await logger.task("job", async () => {});

    const text = logger.metricsText();
    expect(text).toContain("hp_logger_operation_ms");
    expect(text).toContain('operation="db"');
    expect(text).toContain('operation="render"');
    expect(text).toContain('operation="job"');
  });

  test("operation names beyond the cap collapse into _other", async () => {
    const { logger } = captureLogger({
      level: "debug",
      mode: "json",
      profile: { maxOperations: 1 },
    });

    await logger.time("first", async () => {});
    await logger.time("second", async () => {});
    await logger.time("first", async () => {});

    const text = logger.metricsText();
    expect(text).toContain('operation="first"');
    expect(text).not.toContain('operation="second"');
    expect(text).toContain('operation="_other"');
  });

  test("disabled profiling creates no metrics and costs nothing", async () => {
    const { logger } = captureLogger({ level: "debug", mode: "json" });
    await logger.time("quiet", async () => {});
    expect(logger.metricsText()).toBe("");
  });

  test("profiling can be toggled at runtime", async () => {
    const { logger } = captureLogger({ level: "debug", mode: "json" });
    await logger.time("before", async () => {});
    expect(logger.metricsText()).toBe("");

    logger.settings({ profile: true });
    await logger.time("after", async () => {});
    expect(logger.metricsText()).toContain('operation="after"');

    logger.settings({ profile: false });
    await logger.time("later", async () => {});
    expect(logger.metricsText()).not.toContain('operation="later"');
  });
});
