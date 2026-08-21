import type { Registry } from './registry';

export type MetricType = 'counter' | 'gauge' | 'histogram';

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
