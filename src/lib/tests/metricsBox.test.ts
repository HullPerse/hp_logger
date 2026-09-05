import { describe, expect, test } from "bun:test";

import { captureLogger } from "./test.transport.js";

describe("logger.metricsBox", () => {
  test("renders a framed table of every registered metric", async () => {
    const { entries, logger } = captureLogger({ level: "debug", mode: "json", profile: true });

    const hits = logger.counter({ help: "hits", labelNames: ["kind"], name: "hits_total" });
    hits.inc({ kind: "home" }, 3);
    const temperature = logger.gauge({ help: "temp", name: "temperature" });
    temperature.set(21.5);
    await logger.time("db", async () => {});

    logger.metricsBox();
    const message = entries.at(-1)?.message ?? "";
    const lines = message.split("\n");

    expect(lines[0]?.startsWith("+-- metrics")).toBe(true);
    expect(lines.at(-1)).toMatch(/^\+-+\+$/u);
    expect(lines[1]).toMatch(/^\| /u);
    expect(message).toContain("counter hits_total");
    expect(message).toContain('kind="home"');
    expect(message).toMatch(/\s3 \|$/mu);
    expect(message).toContain("gauge temperature");
    expect(message).toContain("histogram hp_logger_operation_ms");
    expect(message).toContain('operation="db"');
    // Plain text only: frames must survive file and json transports.
    expect(message.includes("\u001B")).toBe(false);
  });

  test("an empty registry renders the no-metrics note inside the frame", () => {
    const { entries, logger } = captureLogger({ level: "debug", mode: "json" });
    logger.metricsBox();
    const lines = (entries.at(-1)?.message ?? "").split("\n");
    // "no metrics recorded" is 19 visible chars; the titled border carries
    // width - title.length - 2 = 10 dashes after the label.
    expect(lines[0]).toBe(`+-- metrics ${"-".repeat(10)}+`);
    expect(lines[1]).toBe("| no metrics recorded |");
    expect(lines[2]).toBe(`+${"-".repeat(21)}+`);
  });
});
