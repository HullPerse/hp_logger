import { drawBox } from "../format/box.format";
import { renderMetricsTable } from "../format/metrics.format";
import { Counter } from "../metrics/counter.metric";
import { Gauge } from "../metrics/gauge.metric";
import { Histogram } from "../metrics/histogram.metric";
import { Registry } from "../metrics/registry.metric";
import type { LogLevel } from "../types/logger";
import type { MetricOptions } from "../types/metrics";

// Helpers operate on a Logger instance via any to access private fields without circular private checks.
// They are extracted from Logger to reduce god-class size while keeping the facade in logger.api.ts.

export const getOrCreateRegistry = (logger: unknown): Registry => {
  const self = logger as {
    metricsRegistryInstance: Registry | null;
  };
  if (self.metricsRegistryInstance === null) {
    self.metricsRegistryInstance = new Registry();
  }
  return self.metricsRegistryInstance;
};

export const ensureAutoCounter = (logger: unknown): void => {
  const self = logger as {
    autoCounter: Counter | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metricsRegistry: () => Registry;
  };
  if (self.autoCounter !== null) return;
  // SAFETY: Logger.metricsRegistry is private but accessible at runtime; helper is called only from Logger.
  const registry = (logger as { metricsRegistry: () => Registry }).metricsRegistry();
  self.autoCounter = new Counter({
    help: "Log entries written by this logger",
    labelNames: ["author", "level"],
    name: "hp_logger_entries_total",
    registers: [registry],
  });
};

type BoundMetricCtor<T> = new (options: MetricOptions & { registers: Registry[] }) => T;

const bindRegistry = <T>(
  logger: unknown,
  Ctor: BoundMetricCtor<T>,
  options: Omit<MetricOptions, "registers">,
): T => {
  const registry = getOrCreateRegistry(logger);
  return new Ctor({ ...options, registers: [registry] });
};

export const createCounter = (
  logger: unknown,
  options: Omit<MetricOptions, "registers">,
): Counter => bindRegistry(logger, Counter, options);

export const createGauge = (
  logger: unknown,
  options: Omit<MetricOptions, "registers">,
): Gauge => bindRegistry(logger, Gauge, options);

export const createHistogram = (
  logger: unknown,
  options: Omit<MetricOptions, "registers"> & { buckets?: readonly number[] },
): Histogram => bindRegistry(logger, Histogram, options);

export const getMetricsText = (logger: unknown): string => {
  const self = logger as { metricsRegistryInstance: Registry | null };
  return self.metricsRegistryInstance?.metrics() ?? "";
};

export const writeMetricsBox = (logger: unknown, level: LogLevel = "info"): void => {
  const self = logger as {
    metricsRegistryInstance: Registry | null;
    write: (level: LogLevel, message: string) => void;
  };
  const snapshots = self.metricsRegistryInstance?.snapshots() ?? [];
  const body =
    snapshots.length === 0 ? ["no metrics recorded"] : renderMetricsTable(snapshots).split("\n");
  self.write(level, drawBox(body, { title: "metrics" }).join("\n"));
};
