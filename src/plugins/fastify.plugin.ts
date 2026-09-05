import type { FastifyInstance } from "fastify";

import type { Logger } from "../api/logger.api.js";
import type { RequestLogOptions, RequestMeta } from "../types/integrations.js";
import {
  CORRELATION_ID_HEADER,
  finishRequest,
  pathFromUrl,
  resolveCorrelationId,
  skipSet,
} from "./shared.plugin.js";

export const fastifyPlugin = (
  fastify: FastifyInstance,
  logger: Logger,
  options: RequestLogOptions = {},
): void => {
  const skip = skipSet(options);
  const requests = new WeakMap<object, RequestMeta>();

  fastify.addHook("onRequest", (request, _reply, done) => {
    requests.set(request, {
      correlationId: resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]),
      startedAt: performance.now(),
    });
    done();
  });

  fastify.addHook("onRoute", (routeOptions) => {
    const { handler: originalHandler } = routeOptions;
    routeOptions.handler = function handler(request, reply) {
      // onRequest already resolved the id for this request; reuse it so the
      // context and the log line never diverge (a fresh resolve would mint a
      // second uuid when the header is absent).
      const meta = requests.get(request);
      const correlationId =
        meta?.correlationId ?? resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
      return logger.withContext({ correlationId }, () =>
        originalHandler.call(this, request, reply),
      );
    };
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    const meta = requests.get(request);
    if (meta) {
      finishRequest(logger, options, skip, {
        correlationId: meta.correlationId,
        method: request.method,
        path: pathFromUrl(request.url),
        startedAt: meta.startedAt,
        status: reply.statusCode,
      });
    }
    done();
  });
};
