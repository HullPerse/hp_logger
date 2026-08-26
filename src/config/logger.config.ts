export const DEFAULT_AUTHOR = "ROOT";
/** Deepest span chain tracked in `context.spanPath`; deeper nesting truncates. */
export const SPAN_PATH_MAX_DEPTH = 32;
/**
 * Cap for the process-wide once()/throttle() key stores. Beyond it, the
 * least-recently-used key is forgotten and may log again - bounded memory
 * wins over infinite dedupe on caller-supplied keys.
 */
export const ONCE_THROTTLE_CACHE_CAP = 4096;
