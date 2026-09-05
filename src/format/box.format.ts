import { applyColor } from "../lib/color.utils";
import type { ColorName } from "../types/logger";

export interface BoxOptions {
  /** Frame color; `false` or omitted renders plain ASCII. */
  color?: ColorName | false;
  /** Text shown in the top border: `+-- title -----+`. */
  title?: string;
  /** Minimum inner content width; the frame never shrinks below the longest line. */
  width?: number;
}

// The ESC byte is intentional: it is the only way to measure rendered text
// without counting invisible ANSI sequences as visible columns.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/gu;

/** Length as seen by the terminal: ANSI escape sequences do not count. */
const visibleLength = (line: string): number => line.replaceAll(ANSI_PATTERN, "").length;

/**
 * Frame multiline text with ASCII box characters (`+ - |`). Content lines are
 * padded to a common visible width so colored content cannot skew alignment.
 * Returns one string per output line; callers join them.
 */
export const drawBox = (lines: string[], options: BoxOptions = {}): string[] => {
  const { color = false, title = "", width: minWidth } = options;
  let width = title === "" ? 0 : title.length + 2;
  if (minWidth !== undefined && minWidth > width) width = minWidth;
  for (const line of lines) {
    const length = visibleLength(line);
    if (length > width) width = length;
  }

  const dashes = "-".repeat(width);
  // Width math: a titled top is "+--" + " " + title + " " + dashes + "+",
  // which matches the plain "+-" + dashes + "-+" only at title.length + 2.
  const plain = `+-${dashes}-+`;
  const top =
    title === ""
      ? applyColor(color, plain)
      : applyColor(color, `+-- ${title} ${"-".repeat(width - title.length - 2)}+`);
  const bottom = applyColor(color, plain);
  const body = lines.map((line) => {
    // Pad by visible length: ANSI escapes in content must not skew the frame.
    const padding = " ".repeat(width - visibleLength(line));
    return `| ${line}${padding} |`;
  });

  return [top, ...body, bottom];
};
