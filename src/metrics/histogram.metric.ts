import { DEFAULT_BUCKETS as defaultBuckets } from "../config/metrics.config.js";
import type {
  HistogramEntry,
  HistogramOptions,
  LabelValues,
  MetricSnapshot,
} from "../types/metrics.js";
import { BaseMetric } from "./base.metric.js";

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

  /**
   * Estimate the q-quantile (0..1) for the given labels, interpolating inside
   * the bucket that crosses the rank. NaN when there are no observations.
   */
  quantile(q: number, labels: LabelValues = {}): number {
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new Error("quantile must be a finite number between 0 and 1");
    }
    return this.quantileOf(this.entries.get(this.labelKey(labels)), q);
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
      const bucket = this.buckets[i];
      if (bucket !== undefined && value <= bucket) {
        entry.bucketCounts[i] = (entry.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  snapshot(): MetricSnapshot {
    return {
      help: this.help,
      name: this.name,
      rows: this.sortedEntries().map(([key, entry]) => ({
        count: entry.count,
        key,
        p50: this.quantileOf(entry, 0.5),
        p95: this.quantileOf(entry, 0.95),
        sum: entry.sum,
      })),
      type: this.type,
    };
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

  private quantileOf(entry: HistogramEntry | undefined, q: number): number {
    if (entry === undefined || entry.count === 0) return Number.NaN;
    const target = q * entry.count;
    let previousCount = 0;
    for (let i = 0; i < this.buckets.length; i += 1) {
      const bucket = this.buckets[i];
      const bucketCount = entry.bucketCounts[i] ?? 0;
      if (bucket === undefined) continue;
      if (bucketCount >= target) {
        const inBucket = bucketCount - previousCount;
        const previousBucket = i > 0 ? (this.buckets[i - 1] ?? 0) : 0;
        const rankInBucket = inBucket === 0 ? 0 : (target - previousCount) / inBucket;
        return previousBucket + (bucket - previousBucket) * rankInBucket;
      }
      previousCount = bucketCount;
    }
    return Number.NaN;
  }

  private sortedEntries(): [string, HistogramEntry][] {
    return BaseMetric.sortedSamples(this.entries);
  }
}
