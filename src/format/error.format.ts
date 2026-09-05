import { formatContext } from "./context.format";
import type { LogContext } from "../types/logger";

interface ErrorLike {
  cause?: unknown;
  message?: string;
  name?: string;
}

const ERROR_KEYS = new Set(["error", "reason"]);

const isErrorLike = (value: unknown): value is ErrorLike =>
  typeof value === "object" &&
  value !== null &&
  ("name" in value || "message" in value || "cause" in value);

const errorTitle = (error: ErrorLike): string => {
  const name = typeof error.name === "string" ? error.name : "Error";
  const message = typeof error.message === "string" && error.message !== "" ? error.message : "";
  return `${name}${message ? `: ${message}` : ""}`;
};

/** Render the cause chain of an error-like value, one indented line per level. */
const renderCauseChain = (error: unknown, depth: number, lines: string[]): void => {
  if (depth > 4 || !isErrorLike(error)) return;
  lines.push(`${"  ".repeat(depth)}✗ ${errorTitle(error)}`);
  renderCauseChain(error.cause, depth + 1, lines);
};

/**
 * Pretty error block for console output: the error chain, then the rest of
 * the context as key=value lines. Returns null when nothing error-like is in
 * the context and the regular context rendering is used instead.
 */
export const formatPrettyErrorBlock = (context: LogContext): string | null => {
  const main = context.error ?? context.reason;
  if (!isErrorLike(main)) return null;

  const lines: string[] = [];
  renderCauseChain(main, 0, lines);
  const rest: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (ERROR_KEYS.has(key)) continue;
    rest[key] = value;
  }
  const rendered = formatContext(rest, "kv");
  const restLine = rendered === "" ? "" : ` ${rendered}`;
  return `${lines.join("\n")}\n${restLine}`;
};
