import type { Registry } from "../metrics/registry.metric.js";

export type MetricType = "counter" | "gauge" | "histogram";

/** Label values for a sample. Keys must match the metric's labelNames. */
export type LabelValues = Record<string, string | number>;

export interface MetricOptions {
  /** Short description shown in the # HELP line. */
  help: string;
  /** Ordered label names; order is not significant in output. */
  labelNames?: readonly string[];
  /** Metric name, must match [a-zA-Z_:][a-zA-Z0-9_:]*. */
  name: string;
  /** Registries that collect this metric. */
  registers?: Registry[];
}

export interface Metric {
  readonly help: string;
  readonly name: string;
  readonly type: MetricType;
  /** Prometheus text format lines for this metric. */
  toText: () => string;
}

export interface HistogramOptions extends MetricOptions {
  /** Bucket upper bounds in ascending order. Defaults to prometheus defaults. */
  buckets?: readonly number[];
}

/** One label set of a metric with its current values. */
export interface MetricRow {
  count?: number;
  /** Serialized label key as in Prometheus text, "" when unlabeled. */
  key: string;
  p50?: number;
  p95?: number;
  sum?: number;
  value?: number;
}

/** Plain-data view of one metric for table rendering (`logger.metricsBox`). */
export interface MetricSnapshot {
  help: string;
  name: string;
  rows: MetricRow[];
  type: MetricType;
}

/** Implemented by the built-in metrics so registries can expose snapshots. */
export interface MetricSnapshotProvider {
  snapshot: () => MetricSnapshot;
}

/** Per-label-set histogram state. */
export interface HistogramEntry {
  bucketCounts: number[];
  count: number;
  sum: number;
}
