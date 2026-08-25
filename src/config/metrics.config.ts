export const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/u;
export const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/** Buckets for `hp_logger_operation_ms`, which records durations in ms. */
export const DEFAULT_OPERATION_BUCKETS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000,
] as const;

/** Metric name of the profiler histogram fed by time()/span()/task(). */
export const OPERATION_METRIC_NAME = "hp_logger_operation_ms";

/** Distinct operation names tracked by the profiler before `_other`. */
export const DEFAULT_MAX_OPERATIONS = 64;

/** Label used for operations beyond the profiler's name cap. */
export const PROFILE_OVERFLOW_LABEL = "_other";

/** Default update interval for process metrics gauges. */
export const DEFAULT_PROCESS_METRICS_INTERVAL = 5000;
