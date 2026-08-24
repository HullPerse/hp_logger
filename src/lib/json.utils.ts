import { attempt } from "./result.utils";

/** JSON.stringify with a fallback: never throws on hostile values. */
export const safeStringify = (value: unknown): string => {
  const outcome = attempt(() => JSON.stringify(value));
  return outcome.ok && typeof outcome.value === "string" ? outcome.value : "[unserializable]";
};

// Build the character class from `\uXXXX` escapes so no raw control
// characters appear in source (keeps lint noise down); tab, newline and
// carriage return are preserved.
const CONTROL_CHARACTER_SOURCE = ((): string => {
  const codes: string[] = [];
  for (let code = 0x00; code <= 0x1f; code += 1) {
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    codes.push(`\\u${code.toString(16).padStart(4, "0")}`);
  }
  codes.push("\\u007f");
  return codes.join("");
})();

const CONTROL_CHARACTER_PATTERN = new RegExp(`[${CONTROL_CHARACTER_SOURCE}]`, "gu");

/** Strip terminal/control characters except tab and newline. */
export const stripControlCharacters = (text: string): string =>
  text.replaceAll(CONTROL_CHARACTER_PATTERN, "");