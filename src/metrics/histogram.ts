import { BaseMetric } from './base';
import type { LabelValues, MetricOptions } from './types';

export interface HistogramOptions extends MetricOptions {
  /** Bucket upper bounds in ascending order. Defaults to prometheus defaults. */
  buckets?: readonly number[];
}

export const DEFAULT_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

interface HistogramEntry {
  bucketCounts: number[];
  count: number;
  sum: number;
}

/** Distribution of observations over configured buckets. */
export class Histogram extends BaseMetric {
  readonly type = 'histogram' as const;
  readonly buckets: readonly number[];
  private readonly entries = new Map<string, HistogramEntry>();

  constructor(options: HistogramOptions) {
    super(options);
    const buckets = [...(options.buckets ?? DEFAULT_BUCKETS)].toSorted((a, b) => a - b);
    if (buckets.length === 0) {
      throw new Error('Histogram buckets must not be empty');
    }
    this.buckets = buckets;
    for (const registry of options.registers ?? []) {
      registry.register(this);
    }
  }

  /** Record one observation for the given labels. */
  observe(labels: LabelValues, value: number): void {
    const key = this.labelKey(labels);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { bucketCounts: Array.from({ length: this.buckets.length }, () => 0), count: 0, sum: 0 };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    entry.sum += value;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (value <= this.buckets[i]) {
        entry.bucketCounts[i] += 1;
      }
    }
  }

  toText: () => string = () => {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [key, entry] of this.sortedEntries()) {
      const labels = key ? `,${key}` : '';
      const bucketLines = this.buckets.map(
        (bucket, i) =>
          `${this.name}_bucket{le="${bucket}"${labels}} ${entry.bucketCounts[i]}`
      );
      lines.push(
        ...bucketLines,
        `${this.name}_bucket{le="+Inf"${labels}} ${entry.count}`,
        `${this.name}_sum${Histogram.renderLabels(key)} ${entry.sum}`,
        `${this.name}_count${Histogram.renderLabels(key)} ${entry.count}`
      );
    }
    return lines.join('\n');
  };

  private sortedEntries(): [string, HistogramEntry][] {
    return [...this.entries.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }

  private static renderLabels(key: string): string {
    return key ? `{${key}}` : '';
  }
}
