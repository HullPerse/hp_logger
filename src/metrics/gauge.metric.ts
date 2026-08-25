import type { LabelValues, MetricSnapshot } from "../types/metrics";
import { BaseMetric } from "./base.metric";

/** Value that can go up and down. */
export class Gauge extends BaseMetric {
  readonly type = "gauge" as const;
  private readonly values = new Map<string, number>();

  /** Set an absolute value for the given labels. */
  set(value: number, labels: LabelValues = {}): void {
    this.values.set(this.labelKey(labels), value);
  }

  /** Increase by `value` (default 1) for the given labels. */
  inc(labels: LabelValues = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Decrease by `value` (default 1) for the given labels. */
  dec(labels: LabelValues = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) - value);
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
