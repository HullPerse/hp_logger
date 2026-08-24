import { DEFAULT_INTERVAL, DEFAULT_TIMEOUT } from "../config/watch.config";
import { attemptAsync } from "../lib/result.utils";
import type { ProbeOutcome, WatchHooks, WatchOptions, WatchReason, Watcher } from "../types/watch";

class StatusMismatchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "StatusMismatchError";
    this.status = status;
  }
}

const classifyError = (error: Error): { reason: WatchReason; normalized: Error } => {
  if (error instanceof StatusMismatchError) return { normalized: error, reason: "status" };
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return { normalized: error, reason: "timeout" };
  }
  const { code } = error as NodeJS.ErrnoException;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { normalized: error, reason: "dns" };
  if (code === "ECONNREFUSED") return { normalized: error, reason: "refused" };
  return { normalized: error, reason: "status" };
};

const probeOnce = async (options: WatchOptions, timeout: number): Promise<ProbeOutcome> => {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  if (options.probe) {
    const { probe } = options;
    const outcome = await attemptAsync(() => probe());
    if (outcome.ok) return { latencyMs: elapsed(), ok: Boolean(outcome.value), status: 0 };
    return { error: outcome.error, latencyMs: elapsed(), ok: false, status: 0 };
  }

  const outcome = await attemptAsync(() =>
    fetch(options.url as string, {
      method: options.method ?? "HEAD",
      signal: AbortSignal.timeout(timeout),
    }),
  );
  if (!outcome.ok) {
    return { error: outcome.error, latencyMs: elapsed(), ok: false, status: 0 };
  }
  const expected = options.isUp?.(outcome.value.status) ?? outcome.value.ok;
  if (!expected) {
    const mismatch = new StatusMismatchError(outcome.value.status);
    return { error: mismatch, latencyMs: elapsed(), ok: false, status: mismatch.status };
  }
  return { latencyMs: elapsed(), ok: true, status: outcome.value.status };
};

/**
 * Poll a url or custom probe and log the edges. Fires onConnect on the first
 * success and every down -> up transition; onDisconnect only when a previously
 * up target goes down; onError for each failed probe. Transitions are logged
 * automatically (success/warn); single probes stay silent unless
 * `logProbes` is set.
 */
export const startWatcher = (
  log: (
    level: "debug" | "success" | "warn",
    message: string,
    context: Record<string, unknown>,
  ) => void,
  rawOptions: WatchOptions,
  hooks: WatchHooks = {},
): Watcher => {
  const interval = rawOptions.interval ?? DEFAULT_INTERVAL;
  const timeout = rawOptions.timeout ?? DEFAULT_TIMEOUT;
  if (!rawOptions.url && !rawOptions.probe) {
    throw new Error("watch requires a url or a probe function");
  }

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let up: boolean | null = null;

  const failReasonOf = (outcome: ProbeOutcome): WatchReason => {
    if (!outcome.error) return "status";
    return classifyError(outcome.error).reason;
  };

  const runProbe = async (): Promise<void> => {
    if (stopped) return;
    const outcome = await probeOnce(rawOptions, timeout);

    if (outcome.ok) {
      const info = {
        latencyMs: outcome.latencyMs,
        status: outcome.status,
      };
      if (up !== true) {
        up = true;
        hooks.onConnect?.(info);
        log("success", "watch connected", { ...info });
      }
      hooks.onSuccess?.(info);
      if (rawOptions.logProbes) {
        log("debug", "watch probe ok", { ...info });
      }
      return;
    }

    const info = {
      error: outcome.error,
      latencyMs: outcome.latencyMs,
      reason: failReasonOf(outcome),
    };
    hooks.onError?.({ error: info.error, reason: info.reason });
    if (rawOptions.logProbes) {
      log("debug", "watch probe failed", {
        error: info.error?.message,
        latencyMs: info.latencyMs,
        reason: info.reason,
      });
    }
    if (up === true) {
      up = false;
      hooks.onDisconnect?.({ error: info.error, reason: info.reason });
      log("warn", "watch disconnected", {
        error: info.error?.message,
        reason: info.reason,
      });
    } else if (up === null) {
      up = false;
      log("warn", "watch unreachable", {
        error: info.error?.message,
        reason: info.reason,
      });
    }
  };

  const stop = (): void => {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  // runProbe never rejects: probeOnce normalizes every failure into an outcome.
  runProbe();
  timer = setInterval(() => {
    runProbe();
  }, interval);
  timer.unref();

  return {
    runProbe,
    stop,
    get up() {
      return up;
    },
  };
};
