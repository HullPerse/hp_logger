import { DEFAULT_INTERVAL, DEFAULT_TIMEOUT } from "../config/watch.config";
import { attemptAsync } from "../lib/result.utils";
import { applyJitter } from "../lib/retry.utils";
import { startUnrefTimeout, stopTimeout } from "../lib/transport.utils";
import type { ProbeOutcome, WatchHooks, WatchOptions, WatchReason, Watcher } from "../types/watch";

class StatusMismatchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "StatusMismatchError";
    this.status = status;
  }
}

const CODE_REASONS: Record<string, WatchReason> = {
  EAI_AGAIN: "dns",
  ECONNREFUSED: "refused",
  ENOTFOUND: "dns",
};

const classifyError = (error: Error): { reason: WatchReason; normalized: Error } => {
  if (error instanceof StatusMismatchError) return { normalized: error, reason: "status" };
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return { normalized: error, reason: "timeout" };
  }
  const { code } = error as NodeJS.ErrnoException;
  const byCode = code === undefined ? undefined : CODE_REASONS[code];
  if (byCode !== undefined) return { normalized: error, reason: byCode };
  return { normalized: error, reason: "status" };
};

const successInfo = (outcome: ProbeOutcome) => ({
  latencyMs: outcome.latencyMs,
  status: outcome.status,
});

/** Backoff delay before the Nth retry probe (1-based), capped at maxMs. */
export const watchBackoffMs = (
  failures: number,
  opts: { interval: number; maxMs: number },
): number => Math.min(opts.interval * 2 ** Math.max(0, failures - 1), opts.maxMs);

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
  const backoff = rawOptions.backoff === false ? undefined : rawOptions.backoff;
  const backoffMaxMs = backoff?.maxMs ?? interval * 10;
  const backoffJitter = backoff?.jitter ?? 0.25;
  if (!rawOptions.url && !rawOptions.probe) {
    throw new Error("watch requires a url or a probe function");
  }

  // One shared lifecycle flag as an object property: a plain boolean gets
  // literal-narrowed inside closures, which breaks the scheduled-probe guard.
  const lifecycle = { stopped: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let up: boolean | null = null;
  let consecutiveFailures = 0;

  const failReasonOf = (outcome: ProbeOutcome): WatchReason => {
    if (!outcome.error) return "status";
    return classifyError(outcome.error).reason;
  };


  const failureInfo = (outcome: ProbeOutcome) => ({
    error: outcome.error,
    latencyMs: outcome.latencyMs,
    reason: failReasonOf(outcome),
  });

  const fireStatusHooks = (info: { latencyMs: number; status: number }): void => {
    hooks.onStatus?.[info.status]?.(info);
    if (info.status === 403) hooks.onForbidden?.(info);
  };

  const handleSuccess = (outcome: ProbeOutcome): void => {
    const info = successInfo(outcome);
    if (up !== true) {
      up = true;
      hooks.onConnect?.(info);
      log("success", "watch connected", { ...info });
    }
    hooks.onSuccess?.(info);
    fireStatusHooks(info);
    if (rawOptions.logProbes) {
      log("debug", "watch probe ok", { ...info });
    }
  };

  const handleFailure = (outcome: ProbeOutcome): void => {
    const info = failureInfo(outcome);
    if (outcome.status !== 0) {
      fireStatusHooks({ latencyMs: outcome.latencyMs, status: outcome.status });
    }
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

  const runProbe = async (): Promise<void> => {
    if (lifecycle.stopped) return;
    const outcome = await probeOnce(rawOptions, timeout);
    if (outcome.ok) {
      consecutiveFailures = 0;
      handleSuccess(outcome);
    } else {
      consecutiveFailures += 1;
      handleFailure(outcome);
    }
    // A stop() landing mid-probe leaves one harmless no-op timer behind;
    // the top-of-runProbe guard swallows it.
    let delay = interval;
    if (!outcome.ok && backoff !== undefined) {
      delay = applyJitter(
        watchBackoffMs(consecutiveFailures, { interval, maxMs: backoffMaxMs }),
        backoffJitter,
      );
    }
    timer = startUnrefTimeout(() => {
      runProbe();
    }, delay);
  };

  const stop = (): void => {
    lifecycle.stopped = true;
    stopTimeout(timer);
    timer = null;
  };

  // runProbe never rejects: probeOnce normalizes every failure into an outcome.
  const probe = (): void => {
    runProbe();
  };
  probe();

  return {
    runProbe,
    stop,
    get up() {
      return up;
    },
  };
};
