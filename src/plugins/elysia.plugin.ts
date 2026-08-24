import { Elysia } from "elysia";

import type { Logger } from "../api/logger.api";
import { DEFAULT_SKIP_PATHS, ELYSIA_ERROR_STATUS } from "../config/integrations.config";
import type { RequestInfo, RequestLogOptions, RequestMeta } from "../types/integrations";
import { levelForStatus, pathFromUrl, resolveCorrelationId } from "./shared.plugin";

export const elysiaPlugin = (logger: Logger, options: RequestLogOptions = {}): Elysia => {
  const requests = new WeakMap<Request, RequestMeta>();
  const skip = new Set(options.skipPaths ?? DEFAULT_SKIP_PATHS);

  const finish = (request: Request, status: number, correlationId?: string): void => {
    const meta = requests.get(request) ?? {
      correlationId: correlationId ?? "unknown",
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

    logger.logEvent(levelForStatus(status), "request", info);
  };

  return new Elysia({ name: "hp-logger" })
    .onRequest(({ request }) => {
      const correlationId = resolveCorrelationId(
        request.headers.get("x-correlation-id") ?? undefined,
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
