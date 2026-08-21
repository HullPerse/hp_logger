import type { Context, MiddlewareHandler } from 'hono';

import type { Logger } from '../logger';
import { DEFAULT_SKIP_PATHS, levelForStatus, pathFromUrl, resolveCorrelationId } from './shared';
import type { RequestInfo, RequestLogOptions } from './types';

export const honoMiddleware = (
  logger: Logger,
  options: RequestLogOptions = {}
): MiddlewareHandler => {
  const skip = new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

  return async (context: Context, next: () => Promise<void>) => {
    const request = context.req.raw;
    const correlationId = resolveCorrelationId(
      request.headers.get('x-correlation-id') ?? undefined
    );
    const startedAt = performance.now();

    await next();

    const path = pathFromUrl(request.url);
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
