import { RingBuffer } from "../brain/ring.utils";
import type { SpanNode, SpanRecord } from "../types/logger";

/** Monotonic counter for short, collision-free span/trace ids. */
let spanCounter = 0;
let traceCounter = 0;

const toHex = (value: number): string => {
  const safe = value % 65_536;
  return safe.toString(16).padStart(4, "0");
};

/** Generate a short unique span id (s + 4-hex chars). */
export const nextSpanId = (): string => {
  spanCounter += 1;
  return `s${toHex(spanCounter)}`;
};

/** Generate a trace id for the root span (t + 4-hex chars). */
export const nextTraceId = (): string => {
  traceCounter += 1;
  return `t${toHex(traceCounter)}`;
};

/**
 * Build a forest of span trees from records. Roots are spans without a
 * parent (or whose parent is not present). Shared by traceTree rendering
 * and the http /spans route.
 */
export const buildSpanTree = (records: SpanRecord[]): SpanNode[] => {
  const nodes = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];
  for (const record of records) {
    nodes.set(record.spanId, { children: [], record });
  }
  for (const record of records) {
    const node = nodes.get(record.spanId);
    if (node === undefined) continue;
    if (record.parentId === undefined) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(record.parentId);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
};

/**
 * Bounded ring of completed spans, grouped by trace. Keeps the last
 * `capacity` spans per process so `logger.trace()` can render a recent tree
 * without unbounded memory.
 */
export class SpanRegistry {
  private readonly buffer: RingBuffer<SpanRecord>;

  constructor(capacity = 200) {
    this.buffer = new RingBuffer<SpanRecord>(capacity);
  }

  /** Record a completed span. */
  add(record: SpanRecord): void {
    this.buffer.push(record);
  }

  /** All spans for a given trace, oldest first. */
  forTrace(traceId: string): SpanRecord[] {
    return this.buffer.toArray().filter((record) => record.traceId === traceId);
  }

  /** The most recent completed spans, oldest first, up to limit (default 100). */
  recent(limit = 100): SpanRecord[] {
    const all = this.buffer.toArray();
    return all.slice(Math.max(0, all.length - limit));
  }

  /** Build a forest of span trees for a trace. Roots are spans without a parent. */
  treeForTrace(traceId: string): SpanNode[] {
    return buildSpanTree(this.forTrace(traceId));
  }

  /** The most recent trace id seen, or undefined when no spans exist. */
  latestTraceId(): string | undefined {
    const all = this.buffer.toArray();
    return all.length > 0 ? all.at(-1)?.traceId : undefined;
  }

  clear(): void {
    this.buffer.clear();
  }
}

/** Module-level singleton registry shared by all loggers in the process. */
let globalRegistry: SpanRegistry | null = null;

/** Get or create the process-wide span registry. */
export const getSpanRegistry = (): SpanRegistry => {
  if (globalRegistry === null) globalRegistry = new SpanRegistry();
  return globalRegistry;
};

/** Replace the registry (test hook). */
export const setSpanRegistry = (registry: SpanRegistry | null): void => {
  globalRegistry = registry;
};
