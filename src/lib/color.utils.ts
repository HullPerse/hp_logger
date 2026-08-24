import pico from "picocolors";

import type { ColorName } from "../types/logger";

const COLOR_FNS: Record<ColorName, (s: string) => string> = {
  black: pico.black,
  blue: pico.blue,
  cyan: pico.cyan,
  gray: pico.gray,
  green: pico.green,
  magenta: pico.magenta,
  red: pico.red,
  white: pico.white,
  yellow: pico.yellow,
};

export const applyColor = (color: ColorName | false | undefined, text: string): string => {
  if (!color) return text;
  return COLOR_FNS[color](text);
};
