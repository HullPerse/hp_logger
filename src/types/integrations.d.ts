import type { LogContext } from "./logger";

export interface RequestLogOptions {
  /** Called for every finished request (including skipped paths). */
  onFinish?: (info: RequestInfo) => void;
  /** Paths that are not logged and not measured, e.g. /health, /metrics. */
  skipPaths?: string[];
}

export interface RequestInfo extends LogContext {
  correlationId?: string;
  durationMs: number;
  method: string;
  path: string;
  status: number;
}

/** Per-request metadata kept between the start and finish hooks. */
export interface RequestMeta {
  correlationId: string;
  startedAt: number;
}
