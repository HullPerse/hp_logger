import { applyColor } from "../lib/color.utils.js";

/**
 * Minimal JSON token colorizer for pretty console context. Keys are cyan,
 * strings green, numbers yellow, booleans and null magenta. Naive by design:
 * it is a display layer over already serialized output, not a parser.
 */
export const colorizeJsonString = (json: string): string =>
  json.replaceAll(
    /(?<string>"(?:[^"\\]|\\.)*")(?<colon>\s*:)?|(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<literal>true|false|null)/gu,
    (match, stringGroup, colon, number, literal) => {
      if (colon !== undefined && stringGroup !== undefined) {
        return `${applyColor("cyan", stringGroup)}${colon}`;
      }
      if (stringGroup !== undefined) return applyColor("green", stringGroup);
      if (literal !== undefined) return applyColor("magenta", literal);
      return applyColor("yellow", number ?? match);
    },
  );
