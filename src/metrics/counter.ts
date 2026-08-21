import { BaseMetric } from './base';
import type { LabelValues, MetricOptions } from './types';

/** Monotonically increasing counter. */
export class Counter extends BaseMetric {
  readonly type = 'counter' as const;
  private readonly values = new Map<string, number>();

  constructor(options: MetricOptions) {
    super(options);
    for (const registry of options.registers ?? []) {
      registry.register(this);
    }
  }

  /** Increment by `value` (default 1) for the given labels. */
  inc(labels: LabelValues = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Current value for the given labels. */
  get(labels: LabelValues = {}): number {
    return this.values.get(this.labelKey(labels)) ?? 0;
  }

  toText(): string {
    const lines = this.headerLines();
    for (const [key, value] of this.sortedValues()) {
      lines.push(`${this.name}${BaseMetric.renderLabels(key)} ${value}`);
    }
    return lines.join('\n');
  }

  private sortedValues(): [string, number][] {
    return [...this.values.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }
}
