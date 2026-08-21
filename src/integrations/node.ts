import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Logger } from '../logger';
import { levelForStatus } from './shared';
import type { RequestInfo, RequestLogOptions } from './types';

type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void;

export const nodeServer = (
  handler: NodeHandler,
  logger: Logger,
  options: RequestLogOptions = {}
): NodeHandler => {
  const skip = new Set(options.skipPaths ?? ['/health', '/metrics']);

  return (request, response) => {
    const headerCorrelationId = request.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(headerCorrelationId)
        ? headerCorrelationId[0]
        : headerCorrelationId)?.trim() ?? crypto.randomUUID();
    const startedAt = performance.now();

    response.on('finish', () => {
      const path = new URL(
        request.url ?? '/',
        'http://localhost'
      ).pathname;
      const durationMs = Math.max(0, performance.now() - startedAt);
      const info: RequestInfo = {
        correlationId,
        durationMs: Math.round(durationMs),
        method: request.method ?? 'GET',
        path,
        status: response.statusCode,
      };

      if (!skip.has(path)) {
        logger.event(levelForStatus(response.statusCode), 'request', info);
      }
    });

    handler(request, response);
  };
};
