import { DEFAULT_PROCESS_METRICS_INTERVAL } from "../config/metrics.config";
import { startUnrefInterval, stopInterval } from "../lib/transport.utils";
import type { Registry } from "./registry.metric";
import { Gauge } from "./gauge.metric";

export interface ProcessMetricsHandle {
  stop: () => void;
}

/**
 * Gauges for process memory and event loop lag, updated on an unref timer:
 * `process_memory_rss_bytes`, `process_memory_heap_total_bytes`,
 * `process_memory_heap_used_bytes`, `process_event_loop_lag_ms` and
 * `process_uptime_seconds`. Call stop() to release the timer.
 */
export const createProcessMetrics = (
  registry: Registry,
  intervalMs: number = DEFAULT_PROCESS_METRICS_INTERVAL,
): ProcessMetricsHandle => {
  const rss = new Gauge({
    help: "Resident set size in bytes",
    name: "process_memory_rss_bytes",
    registers: [registry],
  });
  const heapTotal = new Gauge({
    help: "Total heap size in bytes",
    name: "process_memory_heap_total_bytes",
    registers: [registry],
  });
  const heapUsed = new Gauge({
    help: "Used heap size in bytes",
    name: "process_memory_heap_used_bytes",
    registers: [registry],
  });
  const uptime = new Gauge({
    help: "Process uptime in seconds",
    name: "process_uptime_seconds",
    registers: [registry],
  });
  const lag = new Gauge({
    help: "Event loop lag in milliseconds",
    name: "process_event_loop_lag_ms",
    registers: [registry],
  });
  let lastLagSample = performance.now();

  const update = (): void => {
    const usage = process.memoryUsage();
    rss.set(usage.rss);
    heapTotal.set(usage.heapTotal);
    heapUsed.set(usage.heapUsed);
    uptime.set(process.uptime());
    const now = performance.now();
    lag.set(Math.max(0, now - lastLagSample));
    lastLagSample = now;
  };

  update();
  const timer = startUnrefInterval(update, intervalMs);

  return {
    stop: (): void => {
      stopInterval(timer);
    },
  };
};