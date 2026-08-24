export const DEFAULT_SKIP_PATHS = ["/health", "/metrics"];

/** Map of Elysia error codes to HTTP statuses. */
export const ELYSIA_ERROR_STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  INTERNAL_SERVER_ERROR: 500,
  NOT_FOUND: 404,
  PARSE: 400,
  UNKNOWN: 500,
  VALIDATION: 400,
};
