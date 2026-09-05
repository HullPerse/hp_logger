import type { Logger } from "../api/logger.api.js";
import type { RequestLogOptions } from "../types/integrations.js";
import {
  CORRELATION_ID_HEADER,
  finishRequest,
  pathFromUrl,
  resolveCorrelationId,
  skipSet,
} from "./shared.plugin.js";

type BunHandler = (request: Request) => Response | Promise<Response>;

export const bunServe = (
  handler: BunHandler,
  logger: Logger,
  options: RequestLogOptions = {},
): BunHandler => {
  const skip = skipSet(options);

  return async (request) => {
    const correlationId = resolveCorrelationId(
      request.headers.get(CORRELATION_ID_HEADER) ?? undefined,
    );
    const startedAt = performance.now();
    const path = pathFromUrl(request.url);

    let response: Response;
    try {
      response = await logger.withContext({ correlationId }, () => handler(request));
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
      status: response.status,
    });

    return response;
  };
};
