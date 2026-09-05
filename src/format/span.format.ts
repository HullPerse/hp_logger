import type { SpanNode } from "../types/logger";
import { formatDuration } from "./duration.format";

const BRANCH = "`-- ";
const PIPE = "   ";
const TEE = "+-- ";
const VERTICAL = "|  ";

const pad = (text: string, width: number): string => text.padEnd(width, " ");

const renderNode = (node: SpanNode, prefix: string, isLast: boolean, lines: string[]): void => {
  const connector = isLast ? BRANCH : TEE;
  const { children } = node;
  const { durationMs, name, parentId, spanId } = node.record;
  const duration = formatDuration(durationMs);
  const head = `${prefix}${connector}${name}`;
  const parentSuffix = parentId === undefined ? "" : ` parent=${parentId}`;
  const tail = `  ${duration}  span=${spanId}${parentSuffix}`;
  const paddedHead = pad(head, Math.max(head.length + 1, 24));
  lines.push(`${paddedHead}${tail}`);

  const childPrefix = `${prefix}${isLast ? PIPE : VERTICAL}`;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    renderNode(child, childPrefix, i === children.length - 1, lines);
  }
};

/**
 * Render a span forest as an ASCII tree. Each span shows its name, duration,
 * and span id. Children indent under their parent with ASCII box characters.
 */
export const renderSpanTree = (roots: readonly SpanNode[]): string => {
  const lines: string[] = [];
  for (let i = 0; i < roots.length; i += 1) {
    const node = roots[i];
    if (node === undefined) continue;
    renderNode(node, "", i === roots.length - 1, lines);
  }
  return lines.join("\n");
};
