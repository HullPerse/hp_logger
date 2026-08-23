import type { WatchHandle, WatchHooks, WatchOptions, WatchReason } from './types';

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 3000;

interface ProbeOutcome {
  error?: Error;
  latencyMs: number;
  ok: boolean;
  status: number;
}

export interface Watcher extends WatchHandle {
  runProbe: () => Promise<void>;
}

class StatusMismatchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'StatusMismatchError';
    this.status = status;
  }
}

const classifyError = (error: unknown): { reason: WatchReason; normalized: Error } => {
  if (error instanceof StatusMismatchError) return { normalized: error, reason: 'status' };
  const normalized =
    error instanceof Error ? error : new Error(String(error));
  if (normalized.name === 'AbortError' || normalized.name === 'TimeoutError') {
    return { normalized, reason: 'timeout' };
  }
  const { code } = normalized as NodeJS.ErrnoException;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { normalized, reason: 'dns' };
  if (code === 'ECONNREFUSED') return { normalized, reason: 'refused' };
  return { normalized, reason: 'status' };
};

const probeOnce = async (
  options: WatchOptions,
  timeoutMs: number
): Promise<ProbeOutcome> => {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  if (options.probe) {
    try {
      const result = await options.probe();
      return { latencyMs: elapsed(), ok: Boolean(result), status: 0 };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs: elapsed(),
        ok: false,
        status: 0,
      };
    }
  }

  try {
    const response = await fetch(options.url as string, {
      method: options.method ?? 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const expected = options.expectStatus?.(response.status) ?? response.ok;
    if (!expected) throw new StatusMismatchError(response.status);
    return { latencyMs: elapsed(), ok: true, status: response.status };
  } catch (error) {
    if (error instanceof StatusMismatchError) {
      return { error, latencyMs: elapsed(), ok: false, status: error.status };
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      latencyMs: elapsed(),
      ok: false,
      status: 0,
    };
  }
};

/**
 * Poll a url or custom probe and log the edges. Fires onConnect on the first
 * success and every down -> up transition; onDisconnect only when a previously
 * up target goes down; onError for each failed probe. Transitions are logged
 * automatically (success/warn); single probes stay silent unless
 * `logProbes` is set.
 */
export const startWatcher = (
  log: (level: 'debug' | 'success' | 'warn', message: string, context: Record<string, unknown>) => void,
  rawOptions: WatchOptions,
  hooks: WatchHooks = {}
): Watcher => {
  if (!rawOptions.url && !rawOptions.probe) {
    throw new Error('watch requires a url or a probe function');
  }

  const intervalMs = rawOptions.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let up: boolean | null = null;

  const failReasonOf = (outcome: ProbeOutcome): WatchReason => {
    if (!outcome.error) return 'status';
    return classifyError(outcome.error).reason;
  };

  const runProbe = async (): Promise<void> => {
    if (stopped) return;
    const outcome = await probeOnce(rawOptions, timeoutMs);

    if (outcome.ok) {
      const info = {
        latencyMs: outcome.latencyMs,
        status: outcome.status,
      };
      if (up !== true) {
        up = true;
        hooks.onConnect?.(info);
        log('success', 'watch connected', { ...info });
      }
      hooks.onSuccess?.(info);
      if (rawOptions.logProbes) {
        log('debug', 'watch probe ok', { ...info });
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
      log('debug', 'watch probe failed', {
        error: info.error?.message,
        latencyMs: info.latencyMs,
        reason: info.reason,
      });
    }
    if (up === true) {
      up = false;
      hooks.onDisconnect?.({ error: info.error, reason: info.reason });
      log('warn', 'watch disconnected', {
        error: info.error?.message,
        reason: info.reason,
      });
    } else if (up === null) {
      up = false;
      log('warn', 'watch unreachable', {
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

  void runProbe();
  timer = setInterval(() => {
    void runProbe();
  }, intervalMs);
  timer.unref();

  return {
    runProbe,
    stop,
    get up() {
      return up;
    },
  };
};
