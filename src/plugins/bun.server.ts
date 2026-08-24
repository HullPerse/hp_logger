import type { Logger } from "../api/logger.api";
import { DEFAULT_SKIP_PATHS } from "../config/integrations.config";
import type { RequestInfo, RequestLogOptions } from "../types/integrations";
import { levelForStatus, pathFromUrl, resolveCorrelationId } from "./shared.plugin";

type BunHandler = (request: Request) => Response | Promise<Response>;

export const bunServe = (
  handler: BunHandler,
  logger: Logger,
  options: RequestLogOptions = {},
): BunHandler => {
  const skip = new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

  return async (request) => {
    const correlationId = resolveCorrelationId(
      request.headers.get("x-correlation-id") ?? undefined,
    );
    const startedAt = performance.now();

    const response = await handler(request);
    const path = pathFromUrl(request.url);
    const durationMs = Math.max(0, performance.now() - startedAt);
    const info: RequestInfo = {
      correlationId,
      durationMs: Math.round(durationMs),
      method: request.method,
      path,
      status: response.status,
    };

    if (!skip.has(path)) {
      logger.logEvent(levelForStatus(response.status), "request", info);
    }

    return response;
  };
};
