import pico from 'picocolors';

import type { ColorName } from './types';

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

export const DEFAULT_LEVEL_COLORS: Record<string, ColorName> = {
  debug: 'magenta',
  error: 'red',
  fatal: 'red',
  info: 'blue',
  success: 'green',
  trace: 'gray',
  warn: 'yellow',
};

export const applyColor = (
  color: ColorName | false | undefined,
  text: string
): string => {
  if (!color) return text;
  return COLOR_FNS[color](text);
};
