import type { LabelValues, MetricOptions, MetricType } from './types';

const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/u;
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

/** Base class with name validation and label serialization. */
export abstract class BaseMetric {
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly name: string;
  abstract readonly type: MetricType;

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
  }

  /** Serialized label set without braces, empty when there are no labels. */
  protected labelKey(labels: LabelValues = {}): string {
    return this.labelNames
      .map((name) => `${name}="${BaseMetric.escapeValue(String(labels[name] ?? ''))}"`)
      .join(',');
  }

  /** Render HELP/TYPE header lines for this metric. */
  protected headerLines(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }

  /** Label suffix for a sample line: `{key}` or empty when unlabeled. */
  protected static renderLabels(key: string): string {
    return key ? `{${key}}` : '';
  }

  private static escapeValue(value: string): string {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('\n', '\\n')
      .replaceAll('"', '\\"');
  }
}
