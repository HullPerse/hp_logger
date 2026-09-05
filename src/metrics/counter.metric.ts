import type { LabelValues, MetricSnapshot, MetricType } from "../types/metrics.js";
import { BaseMetric } from "./base.metric.js";

/** Monotonically increasing counter. */
export class Counter extends BaseMetric {
  readonly type: MetricType = "counter";
  protected readonly values = new Map<string, number>();

  /** Increment by `value` (default 1) for the given labels. */
  inc(labels: LabelValues = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Current value for the given labels. */
  get(labels: LabelValues = {}): number {
    return this.values.get(this.labelKey(labels)) ?? 0;
  }

  snapshot(): MetricSnapshot {
    return {
      help: this.help,
      name: this.name,
      rows: BaseMetric.sortedSamples(this.values).map(([key, value]) => ({ key, value })),
      type: this.type,
    };
  }

  toText(): string {
    const lines = this.headerLines();
    for (const [key, value] of BaseMetric.sortedSamples(this.values)) {
      lines.push(`${this.name}${BaseMetric.renderLabels(key)} ${value}`);
    }
    return lines.join("\n");
  }
}
