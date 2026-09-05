import { resolveEnvLevel } from "../lib/settings.utils.js";
import type { LoggerSettings } from "../types/logger.js";
import { createLogger } from "./logger.api.js";
import type { Logger } from "./logger.api.js";

const isFalse = (value: string | undefined): boolean =>
  value !== undefined && (value === "0" || value.toLowerCase() === "false");

/**
 * Container-friendly factory: the whole basic setup comes from environment
 * variables, no code changes per deploy.
 *
 * - `LOG_LEVEL` - root level (trace..fatal)
 * - `LOG_MODULES` - per-module levels, `auth:debug,http:warn`
 * - `LOG_MODE` - `pretty` or `json`
 * - `LOG_FILE` - enables JSON file output at the given path
 * - `LOG_COLOR=false` - disables colors
 */
export const fromEnv = (env: Record<string, string | undefined> = process.env): Logger => {
  const settings: LoggerSettings = {
    level: resolveEnvLevel(env),
  };

  const mode = env.LOG_MODE;
  if (mode === "pretty" || mode === "json") settings.mode = mode;

  if (isFalse(env.LOG_COLOR)) settings.colors = false;

  const file = env.LOG_FILE;
  if (file !== undefined && file !== "") settings.file = { enabled: true, path: file };

  return createLogger({ author: env.LOG_AUTHOR, settings });
};

export { resolveEnvModules } from "../lib/settings.utils.js";
