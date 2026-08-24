import { AsyncLocalStorage } from "node:async_hooks";

import { EMPTY_CONTEXT } from "../config/context.config";
import type { LogContext } from "../types/logger";

const asyncStorage = new AsyncLocalStorage<LogContext>();
let asyncContextUsed = false;

/** Run a function with an async-local context merged over the inherited one. */
export const runWithContext = <T>(context: LogContext, fn: () => T): T => {
  asyncContextUsed = true;
  const inherited = asyncStorage.getStore();
  const scopedContext = inherited === undefined ? context : { ...inherited, ...context };
  return asyncStorage.run(scopedContext, fn);
};

/** The async-local context of the current call, if any was ever created. */
export const getAsyncContext = (): LogContext | undefined =>
  asyncContextUsed ? asyncStorage.getStore() : undefined;

/** Merge static, lazy and async contexts into the final entry context. */
export const mergeEntryContext = (
  staticContext: LogContext,
  hasStaticContext: boolean,
  lazyContext?: LogContext,
  asyncContext?: LogContext,
): LogContext => {
  const hasAsyncContext = asyncContext !== undefined && Object.keys(asyncContext).length > 0;
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
