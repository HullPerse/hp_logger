import { DEFAULT_BUCKETS as defaultBuckets } from "../config/metrics.config";
import type { HistogramEntry, HistogramOptions, LabelValues } from "../types/metrics";
import { BaseMetric } from "./base.metric";

/** Distribution of observations over configured buckets. */
export class Histogram extends BaseMetric {
  readonly type = "histogram" as const;
  readonly buckets: readonly number[];
  private readonly entries = new Map<string, HistogramEntry>();

  constructor(options: HistogramOptions) {
    super(options);
    const buckets = [...(options.buckets ?? defaultBuckets)].toSorted((a, b) => a - b);
    if (buckets.length === 0) {
      throw new Error("Histogram buckets must not be empty");
    }
    this.buckets = buckets;
  }

  /** Record one observation for the given labels. */
  observe(labels: LabelValues, value: number): void {
    const key = this.labelKey(labels);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        bucketCounts: Array.from({ length: this.buckets.length }, () => 0),
        count: 0,
        sum: 0,
      };
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

  toText(): string {
    const lines = this.headerLines();
    for (const [key, entry] of this.sortedEntries()) {
      const labels = key ? `,${key}` : "";
      const bucketLines = this.buckets.map(
        (bucket, i) => `${this.name}_bucket{le="${bucket}"${labels}} ${entry.bucketCounts[i]}`,
      );
      lines.push(
        ...bucketLines,
        `${this.name}_bucket{le="+Inf"${labels}} ${entry.count}`,
        `${this.name}_sum${BaseMetric.renderLabels(key)} ${entry.sum}`,
        `${this.name}_count${BaseMetric.renderLabels(key)} ${entry.count}`,
      );
    }
    return lines.join("\n");
  }

  private sortedEntries(): [string, HistogramEntry][] {
    return BaseMetric.sortedSamples(this.entries);
  }
}
