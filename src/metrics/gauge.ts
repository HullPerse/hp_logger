import { BaseMetric } from './base';
import type { LabelValues, MetricOptions } from './types';

/** Value that can go up and down. */
export class Gauge extends BaseMetric {
  readonly type = 'gauge' as const;
  private readonly values = new Map<string, number>();

  constructor(options: MetricOptions) {
    super(options);
    for (const registry of options.registers ?? []) {
      registry.register(this);
    }
  }

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

  toText: () => string = () => {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    for (const [key, value] of this.sortedValues()) {
      lines.push(`${this.name}${Gauge.renderLabels(key)} ${value}`);
    }
    return lines.join('\n');
  };

  private sortedValues(): [string, number][] {
    return [...this.values.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }

  private static renderLabels(key: string): string {
    return key ? `{${key}}` : '';
  }
}
