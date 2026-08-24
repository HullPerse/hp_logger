import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "../api/logger.api";
import { DEFAULT_SKIP_PATHS } from "../config/integrations.config";
import type { RequestInfo, RequestLogOptions } from "../types/integrations";
import { levelForStatus, pathFromUrl, resolveCorrelationId } from "./shared.plugin";

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

export const nodeServer = (
  handler: NodeHandler,
  logger: Logger,
  options: RequestLogOptions = {},
): NodeHandler => {
  const skip = new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

  return (request, response) => {
    const correlationId = resolveCorrelationId(request.headers["x-correlation-id"]);
    const startedAt = performance.now();

    response.on("finish", () => {
      const path = pathFromUrl(request.url ?? "/");
      const durationMs = Math.max(0, performance.now() - startedAt);
      const info: RequestInfo = {
        correlationId,
        durationMs: Math.round(durationMs),
        method: request.method ?? "GET",
        path,
        status: response.statusCode,
      };

      if (!skip.has(path)) {
        logger.logEvent(levelForStatus(response.statusCode), "request", info);
      }
    });

    handler(request, response);
  };
};
