import { AsyncLocalStorage } from "node:async_hooks";

import { EMPTY_CONTEXT } from "../config/context.config";
import { SPAN_PATH_MAX_DEPTH } from "../config/logger.config";
import type { LogContext } from "../types/logger";

interface CombinedStore {
  context?: LogContext;
  spanPath?: readonly string[];
}

const store = new AsyncLocalStorage<CombinedStore>();
let asyncContextUsed = false;
let spanPathUsed = false;

/** Run a function with an async-local context merged over the inherited one. */
export const runWithContext = <T>(context: LogContext, fn: () => T): T => {
  asyncContextUsed = true;
  const inherited = store.getStore();
  const base = inherited?.context;
  const scopedContext = base === undefined ? context : { ...base, ...context };
  const next: CombinedStore = { ...inherited, context: scopedContext };
  return store.run(next, fn);
};

/** The async-local context of the current call, if any was ever created. */
export const getAsyncContext = (): LogContext | undefined =>
  asyncContextUsed ? store.getStore()?.context : undefined;

/** Run a function with one more span name appended to the active path. */
export const runWithSpanPath = <T>(name: string, fn: () => T): T => {
  spanPathUsed = true;
  const inherited = store.getStore();
  const base = inherited?.spanPath;
  let nextPath: readonly string[];
  if (base === undefined) {
    nextPath = [name];
  } else if (base.length < SPAN_PATH_MAX_DEPTH) {
    nextPath = [...base, name];
  } else {
    nextPath = base;
  }
  const next: CombinedStore = { ...inherited, spanPath: nextPath };
  return store.run(next, fn);
};

/** The active span path of the current call, if any was ever created. */
export const getActiveSpanPath = (): readonly string[] | undefined =>
  spanPathUsed ? store.getStore()?.spanPath : undefined;

/** Merge static, lazy and async contexts into the final entry context. */
const isEmptyContext = (context: LogContext): boolean => {
  for (const _ in context) return false;
  return true;
};

export const mergeEntryContext = (
  staticContext: LogContext,
  hasStaticContext: boolean,
  lazyContext?: LogContext,
  asyncContext?: LogContext,
): LogContext => {
  const hasAsyncContext = asyncContext !== undefined && !isEmptyContext(asyncContext);
  if (!hasStaticContext && lazyContext === undefined) {
    return hasAsyncContext ? asyncContext : EMPTY_CONTEXT;
  }
  if (!hasAsyncContext) {
    if (!hasStaticContext) return lazyContext as LogContext;
    return lazyContext === undefined ? staticContext : { ...staticContext, ...lazyContext };
  }
  if (!hasStaticContext) {
    return lazyContext === undefined ? asyncContext : { ...asyncContext, ...lazyContext };
  }
  return { ...asyncContext, ...staticContext, ...lazyContext };
};
