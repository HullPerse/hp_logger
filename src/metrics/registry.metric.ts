import type { Metric, MetricSnapshot, MetricSnapshotProvider } from "../types/metrics.js";

/** Collects metrics and renders them in Prometheus text format. */
export class Registry {
  private readonly registered = new Map<string, Metric>();

  /** Register a metric; duplicate names are rejected. */
  register(metric: Metric): void {
    if (this.registered.has(metric.name)) {
      throw new Error(`Metric "${metric.name}" is already registered`);
    }
    this.registered.set(metric.name, metric);
  }

  /** Unregister a metric by name. */
  unregister(name: string): void {
    this.registered.delete(name);
  }

  /** Registry contents in stable name order. */
  private sorted(): Metric[] {
    return [...this.registered.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  /** Prometheus text format, metrics sorted by name. */
  metrics(): string {
    const sorted = this.sorted();
    return sorted
      .map((metric) => metric.toText())
      .join("\n")
      .concat("\n");
  }

  /**
   * Plain-data views of all metrics sorted by name. Foreign Metric
   * implementations without snapshot support are skipped.
   */
  snapshots(): MetricSnapshot[] {
    const sorted = this.sorted();
    const out: MetricSnapshot[] = [];
    for (const metric of sorted) {
      const snapshot = (metric as Partial<MetricSnapshotProvider>).snapshot?.call(metric);
      if (snapshot !== undefined) out.push(snapshot);
    }
    return out;
  }
}
