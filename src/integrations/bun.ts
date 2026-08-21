import type { Logger } from '../logger';
import { levelForStatus } from './shared';
import type { RequestInfo, RequestLogOptions } from './types';

type BunHandler = (request: Request) => Response | Promise<Response>;

export const bunServe = (
  handler: BunHandler,
  logger: Logger,
  options: RequestLogOptions = {}
): BunHandler => {
  const skip = new Set(options.skipPaths ?? ['/health', '/metrics']);

  return async (request) => {
    const correlationId =
      request.headers.get('x-correlation-id')?.trim() ?? crypto.randomUUID();
    const startedAt = performance.now();

    const response = await handler(request);
    const path = new URL(request.url).pathname;
    const durationMs = Math.max(0, performance.now() - startedAt);
    const info: RequestInfo = {
      correlationId,
      durationMs: Math.round(durationMs),
      method: request.method,
      path,
      status: response.status,
    };

    if (!skip.has(path)) {
      logger.event(levelForStatus(response.status), 'request', info);
    }

    return response;
  };
};
