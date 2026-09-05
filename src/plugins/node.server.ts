import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "../api/logger.api.js";
import type { RequestLogOptions } from "../types/integrations.js";
import {
  CORRELATION_ID_HEADER,
  finishRequest,
  pathFromUrl,
  resolveCorrelationId,
  skipSet,
} from "./shared.plugin.js";

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

export const nodeServer = (
  handler: NodeHandler,
  logger: Logger,
  options: RequestLogOptions = {},
): NodeHandler => {
  const skip = skipSet(options);

  return (request, response) => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    const startedAt = performance.now();
    const method = request.method ?? "GET";
    const path = pathFromUrl(request.url ?? "/");

    response.on("finish", () => {
      finishRequest(logger, options, skip, {
        correlationId,
        method,
        path,
        startedAt,
        status: response.statusCode,
      });
    });

    try {
      logger.withContext({ correlationId }, () => {
        handler(request, response);
      });
    } catch (error) {
      // A thrown handler never finishes the response; log once here and
      // rethrow so the crash still surfaces exactly as before.
      if (!response.writableEnded) {
        finishRequest(logger, options, skip, {
          correlationId,
          method,
          path,
          startedAt,
          status: 500,
        });
      }
      throw error;
    }
  };
};
