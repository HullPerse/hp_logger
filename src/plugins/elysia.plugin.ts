import { Elysia } from "elysia";

import type { Logger } from "../api/logger.api.js";
import { ELYSIA_ERROR_STATUS } from "../config/integrations.config.js";
import type { RequestLogOptions, RequestMeta } from "../types/integrations.js";
import {
  CORRELATION_ID_HEADER,
  finishRequest,
  pathFromUrl,
  resolveCorrelationId,
  skipSet,
} from "./shared.plugin.js";

export const elysiaPlugin = (logger: Logger, options: RequestLogOptions = {}): Elysia => {
  const requests = new WeakMap<Request, RequestMeta>();
  const skip = skipSet(options);

  const finish = (request: Request, status: number, correlationId?: string): void => {
    const meta = requests.get(request) ?? {
      correlationId: correlationId ?? "unknown",
      startedAt: performance.now(),
    };
    finishRequest(logger, options, skip, {
      correlationId: meta.correlationId,
      method: request.method,
      path: pathFromUrl(request.url),
      startedAt: meta.startedAt,
      status,
    });
  };

  return new Elysia({ name: "hp-logger" })
    .onRequest(({ request }) => {
      const correlationId = resolveCorrelationId(
        request.headers.get(CORRELATION_ID_HEADER) ?? undefined,
      );
      requests.set(request, { correlationId, startedAt: performance.now() });
    })
    .onAfterHandle({ as: "global" }, ({ request, set }) => {
      const status = Number(set.status ?? 200);
      finish(request, status);
    })
    .onError({ as: "global" }, ({ request, code, error }) => {
      const elysiaCode = typeof code === "string" ? code : "UNKNOWN";
      const status =
        ELYSIA_ERROR_STATUS[elysiaCode] ??
        (error instanceof Error && error.message === "Unauthorized" ? 401 : 500);
      finish(request, status);
    });
};
