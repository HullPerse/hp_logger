import { captureCaller } from "../lib/callsite.utils";
import type {
  LazyContext,
  LazyMessage,
  LogContext,
  LogEntry,
  LogLevel,
  LoggerState,
} from "../types/logger";
import type { Transport } from "../types/transport";
import type { LeveledTransport } from "../writer/leveled.writer";
import { getAsyncContext, mergeEntryContext } from "./context.core";

const globalTransports: Transport[] = [];

// Leveled registrations wrap the caller's transport; removal unwraps it, so
// callers always hold and pass the original object.
const leveledWrappers = new Map<Transport, LeveledTransport>();

/** Remember which leveled wrapper belongs to a transport (Logger.addTransport). */
export const registerLeveledWrapper = (transport: Transport, leveled: LeveledTransport): void => {
  leveledWrappers.set(transport, leveled);
};

/**
 * Pop the wrapper for a transport being removed, or undefined when the
 * transport was registered without a level.
 */
export const takeLeveledWrapper = (transport: Transport): LeveledTransport | undefined => {
  const leveled = leveledWrappers.get(transport);
  if (leveled !== undefined) leveledWrappers.delete(transport);
  return leveled;
};

/** Rejection sink: a failing async transport must not crash its host. */
const ignoreTransportRejection = (): void => undefined;

/**
 * Deliver one entry to a transport without an async frame on the hot path.
 * Sync writes return void and cost zero allocations here; async transports
 * get their rejection swallowed exactly like before.
 */
const dispatchToTransport = (transport: Transport, entry: LogEntry): void => {
  try {
    const result = transport.write(entry);
    if (result instanceof Promise) result.catch(ignoreTransportRejection);
  } catch {
    // Sync throws from transports never crash the application either.
  }
};

export const addGlobalTransport = (transport: Transport): void => {
  globalTransports.push(transport);
};

export const removeGlobalTransport = (transport: Transport): void => {
  const index = globalTransports.indexOf(transport);
  if (index !== -1) globalTransports.splice(index, 1);
};

export const clearGlobalTransports = (): void => {
  globalTransports.length = 0;
};

/** Post-build stages shared by both entry paths: black box, sampling, dispatch. */
const deliver = (state: LoggerState, entry: LogEntry): void => {
  // Call-site capture sits after the builders so the compiled fast path
  // stays untouched; only error/fatal entries pay for the stack walk.
  if (state.callSite && (entry.level === "error" || entry.level === "fatal")) {
    entry.callSite = captureCaller();
  }
  state.blackbox?.push(entry);
  // Static base fields are stamped outside context so redaction never masks them.
  if (state.baseFields !== undefined) entry.baseFields = state.baseFields;
  // Sampling sits after the black box: the flight recorder keeps everything,
  // only the transports are sampled. error/fatal always pass.
  const sampledIn =
    state.sampler === undefined || entry.level === "error" || entry.level === "fatal"
      ? true
      : state.sampler(entry);
  if (!sampledIn) return;
  dispatchToTransport(state.transport, entry);
  if (globalTransports.length > 0) {
    for (const transport of globalTransports) dispatchToTransport(transport, entry);
  }
};

/** Synchronous entry path: build, filter, black box, dispatch. */
const dispatchNormal = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  context: LazyContext | undefined,
): void => {
  let entry: LogEntry | null = null;
  try {
    entry = state.entryPlan(state, level, message, context);
  } catch {
    // Hostile context (throwing getters, toJSON) never crashes the caller.
    return;
  }
  if (entry === null) return;
  deliver(state, entry);
};

/**
 * Async resolver path: assemble the full context (static + async + call
 * site), resolve every configured key through the bounded cache, then feed
 * the additions back through the normal builder so they pass serializers,
 * redaction and filters. Entries without resolvable keys never take the async
 * hop; a timeout or error falls back to the raw value.
 */
const writeResolvedEntry = async (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  context: LazyContext | undefined,
): Promise<void> => {
  let resolvedContext: LogContext | undefined;
  if (context !== undefined) {
    try {
      resolvedContext = typeof context === "function" ? context() : context;
    } catch {
      // Hostile context: leave undefined and let entryPlan do its own fallback.
    }
  }
  const resolverSet = state.resolvers;
  let full: LogContext;
  try {
    full = mergeEntryContext(
      state.context,
      state.hasStaticContext,
      resolvedContext,
      getAsyncContext(),
    );
  } catch {
    dispatchNormal(state, level, message, resolvedContext);
    return;
  }
  if (resolverSet === undefined || !resolverSet.hasAny(full)) {
    dispatchNormal(state, level, message, resolvedContext);
    return;
  }
  let additions: Record<string, unknown>;
  try {
    additions = await resolverSet.resolveAll(full);
  } catch {
    additions = {};
  }
  // Additions sit under the explicit call-site data: they win over static
  // and async context, matching how resolvers augment a key it found.
  let enriched: LazyContext | undefined;
  if (resolvedContext === undefined) {
    enriched = Object.keys(additions).length > 0 ? additions : undefined;
  } else {
    enriched = { ...resolvedContext, ...additions };
  }
  dispatchNormal(state, level, message, enriched);
};

/** Route one entry through the pipeline: resolvers first when configured. */
export const writeEntry = (
  state: LoggerState,
  level: LogLevel,
  message: LazyMessage,
  context: LazyContext | undefined,
): void => {
  if (!state.enabled) return;
  if (state.resolvers !== undefined && state.resolvers.size > 0) {
    // Fire-and-forget by contract: resolvers resolve in the background and
    // writeResolvedEntry guards its own errors.
    writeResolvedEntry(state, level, message, context);
    return;
  }
  dispatchNormal(state, level, message, context);
};
