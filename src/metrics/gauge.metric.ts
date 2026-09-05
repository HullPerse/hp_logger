import type { LabelValues } from "../types/metrics";
import { Counter } from "./counter.metric";

/** Value that can go up and down: a counter plus absolute set and decrement. */
export class Gauge extends Counter {
  override readonly type = "gauge" as const;

  /** Set an absolute value for the given labels. */
  set(value: number, labels: LabelValues = {}): void {
    this.values.set(this.labelKey(labels), value);
  }

  /** Decrease by `value` (default 1) for the given labels. */
  dec(labels: LabelValues = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) - value);
  }
}
