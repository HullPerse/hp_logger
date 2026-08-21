import { Elysia } from 'elysia';

import type { Logger } from '../logger';
import { DEFAULT_SKIP_PATHS, levelForStatus, pathFromUrl, resolveCorrelationId } from './shared';
import type { RequestInfo, RequestLogOptions } from './types';

interface RequestMeta {
  correlationId: string;
  startedAt: number;
}

const ELYSIA_ERROR_STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  INTERNAL_SERVER_ERROR: 500,
  NOT_FOUND: 404,
  PARSE: 400,
  UNKNOWN: 500,
  VALIDATION: 400,
};

export const elysiaPlugin = (
  logger: Logger,
  options: RequestLogOptions = {}
): Elysia => {
  const requests = new WeakMap<Request, RequestMeta>();
  const skip = new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

  const finish = (
    request: Request,
    status: number,
    correlationId?: string
  ): void => {
    const meta = requests.get(request) ?? {
      correlationId: correlationId ?? 'unknown',
      startedAt: performance.now(),
    };
    const path = pathFromUrl(request.url);
    const durationMs = Math.max(0, performance.now() - meta.startedAt);
    const info: RequestInfo = {
      correlationId: meta.correlationId,
      durationMs: Math.round(durationMs),
      method: request.method,
      path,
      status,
    };

    options.onFinish?.(info);

    if (skip.has(path)) return;

    logger.event(levelForStatus(status), 'request', info);
  };

  return new Elysia({ name: 'hp-logger' })
    .onRequest(({ request }) => {
      const correlationId = resolveCorrelationId(
        request.headers.get('x-correlation-id') ?? undefined
      );
      requests.set(request, { correlationId, startedAt: performance.now() });
    })
    .onAfterHandle({ as: 'global' }, ({ request, set }) => {
      const status = Number(set.status ?? 200);
      finish(request, status);
    })
    .onError({ as: 'global' }, ({ request, code, error }) => {
      const elysiaCode = typeof code === 'string' ? code : 'UNKNOWN';
      const status =
        ELYSIA_ERROR_STATUS[elysiaCode] ??
        (error instanceof Error && error.message === 'Unauthorized' ? 401 : 500);
      finish(request, status);
    });
};
