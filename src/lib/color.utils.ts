import type { ColorName } from "../types/logger.js";

// ANSI foreground codes: standard 30-37 plus bright black (gray) 90.
// The close code is 39 (default foreground), so a wrapped segment never
// resets surrounding styles (bold, dim) applied by the caller.
const ANSI_CODES: Record<ColorName, readonly [open: string, close: string]> = {
  black: ["\u001B[30m", "\u001B[39m"],
  blue: ["\u001B[34m", "\u001B[39m"],
  cyan: ["\u001B[36m", "\u001B[39m"],
  gray: ["\u001B[90m", "\u001B[39m"],
  green: ["\u001B[32m", "\u001B[39m"],
  magenta: ["\u001B[35m", "\u001B[39m"],
  red: ["\u001B[31m", "\u001B[39m"],
  white: ["\u001B[37m", "\u001B[39m"],
  yellow: ["\u001B[33m", "\u001B[39m"],
};

const style =
  (open: string, close: string) =>
  (text: string): string =>
    `${open}${text}${close}`;

/** Bold text. */
export const bold = style("\u001B[1m", "\u001B[22m");

/** Dim text. */
export const dim = style("\u001B[2m", "\u001B[22m");

/** Wrap text in a level color, or return it unchanged when disabled. */
export const applyColor = (color: ColorName | false | undefined, text: string): string => {
  if (!color) return text;
  const [open, close] = ANSI_CODES[color];
  return `${open}${text}${close}`;
};
