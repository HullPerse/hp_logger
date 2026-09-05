import type { Context, MiddlewareHandler } from "hono";

import type { Logger } from "../api/logger.api";
import type { RequestLogOptions } from "../types/integrations";
import {
  CORRELATION_ID_HEADER,
  finishRequest,
  pathFromUrl,
  resolveCorrelationId,
  skipSet,
} from "./shared.plugin";

export const honoMiddleware = (
  logger: Logger,
  options: RequestLogOptions = {},
): MiddlewareHandler => {
  const skip = skipSet(options);

  return async (context: Context, forward: () => Promise<void>) => {
    const request = context.req.raw;
    const correlationId = resolveCorrelationId(
      request.headers.get(CORRELATION_ID_HEADER) ?? undefined,
    );
    const startedAt = performance.now();
    const path = pathFromUrl(request.url);

    try {
      await logger.withContext({ correlationId }, () => forward());
    } catch (error) {
      finishRequest(logger, options, skip, {
        correlationId,
        method: request.method,
        path,
        startedAt,
        status: 500,
      });
      throw error;
    }
    finishRequest(logger, options, skip, {
      correlationId,
      method: request.method,
      path,
      startedAt,
      status: context.res.status,
    });
  };
};
