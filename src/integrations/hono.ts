import type { Context, MiddlewareHandler } from 'hono';

import type { Logger } from '../logger';
import { levelForStatus } from './shared';
import type { RequestInfo, RequestLogOptions } from './types';

export const honoMiddleware = (
  logger: Logger,
  options: RequestLogOptions = {}
): MiddlewareHandler => {
  const skip = new Set(options.skipPaths ?? ['/health', '/metrics']);

  return async (context: Context, next: () => Promise<void>) => {
    const request = context.req.raw;
    const correlationId =
      request.headers.get('x-correlation-id')?.trim() ?? crypto.randomUUID();
    const startedAt = performance.now();

    await next();

    const path = new URL(request.url).pathname;
    const durationMs = Math.max(0, performance.now() - startedAt);
    const info: RequestInfo = {
      correlationId,
      durationMs: Math.round(durationMs),
      method: request.method,
      path,
      status: context.res.status,
    };

    if (!skip.has(path)) {
      logger.event(levelForStatus(context.res.status), 'request', info);
    }
  };
};
