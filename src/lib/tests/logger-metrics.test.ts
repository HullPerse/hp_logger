import { describe, expect, test } from "bun:test";

import { captureLogger } from "@/lib/tests/test.transport";
import { createProcessMetrics } from "@/metrics/process.metric";
import { Registry } from "@/metrics/registry.metric";

describe("Logger metrics", () => {
  test("counter, gauge and histogram bind to the logger registry", () => {
    const { logger } = captureLogger();
    const requests = logger.counter({ help: "Requests", name: "http_requests_total" });
    const clients = logger.gauge({ help: "Clients", name: "ws_clients" });
    const durations = logger.histogram({
      buckets: [5, 10],
      help: "Durations",
      name: "http_duration_ms",
    });

    requests.inc();
    clients.set(3);
    durations.observe({}, 7);

    const text = logger.metricsText();
    expect(text).toContain("http_requests_total 1");
    expect(text).toContain("ws_clients 3");
    expect(text).toContain('http_duration_ms_bucket{le="10"} 1');
  });

  test("autoCounters count entries by author and level", async () => {
    const { logger } = captureLogger({ autoCounters: true, level: "debug" });
    logger.info("one");
    logger.warn("two");
    logger.info("three");
    logger.error("four");

    const text = logger.metricsText();
    expect(text).toContain('hp_logger_entries_total{author="ROOT",level="info"} 2');
    expect(text).toContain('hp_logger_entries_total{author="ROOT",level="warn"} 1');
    expect(text).toContain('hp_logger_entries_total{author="ROOT",level="error"} 1');
    await logger.close();
  });
});

describe("createProcessMetrics", () => {
  test("exposes memory, uptime and event loop lag gauges", async () => {
    const registry = new Registry();
    const handle = createProcessMetrics(registry, 10);

    const text = registry.metrics();
    expect(text).toContain("process_memory_rss_bytes");
    expect(text).toContain("process_memory_heap_total_bytes");
    expect(text).toContain("process_memory_heap_used_bytes");
    expect(text).toContain("process_uptime_seconds");
    expect(text).toContain("process_event_loop_lag_ms");

    await Bun.sleep(30);
    const updated = registry.metrics();
    expect(updated).toContain("process_event_loop_lag_ms");
    handle.stop();
  });
});
