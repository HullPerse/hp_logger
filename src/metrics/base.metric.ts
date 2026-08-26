import { LABEL_NAME_PATTERN, METRIC_NAME_PATTERN } from "../config/metrics.config";
import type { LabelValues, MetricOptions, MetricSnapshot, MetricType } from "../types/metrics";

/** Base class with name validation and label serialization. */
export abstract class BaseMetric {
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly name: string;
  abstract readonly type: MetricType;
  /** Prometheus text format lines for this metric. */
  abstract toText(): string;
  /** Plain-data view for table rendering. */
  abstract snapshot(): MetricSnapshot;

  constructor(options: MetricOptions) {
    if (!METRIC_NAME_PATTERN.test(options.name)) {
      throw new Error(`Invalid metric name: ${options.name}`);
    }
    this.help = options.help;
    this.name = options.name;
    this.labelNames = [...(options.labelNames ?? [])].toSorted();
    for (const label of this.labelNames) {
      if (!LABEL_NAME_PATTERN.test(label)) {
        throw new Error(`Invalid label name: ${label}`);
      }
    }
    for (const registry of options.registers ?? []) {
      registry.register(this);
    }
  }

  /** Serialized label set without braces, empty when there are no labels. */
  protected labelKey(labels: LabelValues = {}): string {
    return this.labelNames
      .map((name) => `${name}="${BaseMetric.escapeValue(String(labels[name] ?? ""))}"`)
      .join(",");
  }

  /** Render HELP/TYPE header lines for this metric. */
  protected headerLines(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }

  /** Label suffix for a sample line: `{key}` or empty when unlabeled. */
  protected static renderLabels(key: string): string {
    return key ? `{${key}}` : "";
  }

  /** Map entries sorted by serialized label key, stable output order. */
  protected static sortedSamples<T>(samples: Map<string, T>): [string, T][] {
    return [...samples.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }

  // S2: memoize escapeValue since label values repeat across samples.
  private static readonly escapeCache = new Map<string, string>();
  private static readonly ESCAPE_CACHE_CAP = 512;

  private static escapeValue(value: string): string {
    const cached = BaseMetric.escapeCache.get(value);
    if (cached !== undefined) return cached;
    const escaped = value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
    if (BaseMetric.escapeCache.size >= BaseMetric.ESCAPE_CACHE_CAP) {
      const firstKey = BaseMetric.escapeCache.keys().next().value;
      if (firstKey !== undefined) BaseMetric.escapeCache.delete(firstKey);
    }
    BaseMetric.escapeCache.set(value, escaped);
    return escaped;
  }
}
