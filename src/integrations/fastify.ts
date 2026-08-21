import type { FastifyInstance } from 'fastify';

import type { Logger } from '../logger';
import { levelForStatus } from './shared';
import type { RequestLogOptions } from './types';

interface RequestMeta {
  correlationId: string;
  startedAt: number;
}

export const fastifyPlugin = (
  fastify: FastifyInstance,
  logger: Logger,
  options: RequestLogOptions = {}
): void => {
  const skip = new Set(options.skipPaths ?? ['/health', '/metrics']);
  const requests = new WeakMap<object, RequestMeta>();

  fastify.addHook('onRequest', (request, _reply, done) => {
    const headerCorrelationId = request.headers['x-correlation-id'];
    requests.set(request, {
      correlationId:
        (Array.isArray(headerCorrelationId)
          ? headerCorrelationId[0]
          : headerCorrelationId)?.trim() ?? crypto.randomUUID(),
      startedAt: performance.now(),
    });
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const meta = requests.get(request);
    if (meta) {
      const path = new URL(request.url, 'http://localhost').pathname;
      const durationMs = Math.max(0, performance.now() - meta.startedAt);
      if (!skip.has(path)) {
        logger.event(levelForStatus(reply.statusCode), 'request', {
          correlationId: meta.correlationId,
          durationMs: Math.round(durationMs),
          method: request.method,
          path,
          status: reply.statusCode,
        });
      }
    }
    done();
  });
};
