import { DEFAULT_SKIP_PATHS } from "../config/integrations.config";
import type { Logger } from "../api/logger.api";
import type { FinishData, RequestInfo, RequestLogOptions } from "../types/integrations";

export const levelForStatus = (status: number): "error" | "info" | "warn" => {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
};

export const resolveCorrelationId = (header: string | string[] | undefined): string =>
  (Array.isArray(header) ? header[0] : header)?.trim() ?? crypto.randomUUID();

export const pathFromUrl = (url: string): string => new URL(url, "http://localhost").pathname;

/** Header carrying the request correlation id. */
export const CORRELATION_ID_HEADER = "x-correlation-id";

/** Skip set from options with the default paths. */
export const skipSet = (options: RequestLogOptions): Set<string> =>
  new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

/** Log one finished request: onFinish always fires, the skip gate drops only the log line. */
export const finishRequest = (
  logger: Logger,
  options: RequestLogOptions,
  skip: Set<string>,
  data: FinishData,
): void => {
  const info: RequestInfo = {
    correlationId: data.correlationId,
    durationMs: Math.round(Math.max(0, performance.now() - data.startedAt)),
    method: data.method,
    path: data.path,
    status: data.status,
  };
  options.onFinish?.(info);
  if (skip.has(data.path)) return;
  logger.logEvent(levelForStatus(data.status), "request", info);
};
