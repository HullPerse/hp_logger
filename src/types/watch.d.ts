export type WatchReason = "timeout" | "dns" | "refused" | "status";

export interface WatchOptions {
  /** Custom availability check: return falsy or throw to mark the target down. */
  probe?: () => Promise<unknown> | unknown;
  /** Poll interval in milliseconds. */
  interval?: number;
  logProbes?: boolean;
  method?: string;
  isUp?: (status: number) => boolean;
  /** Probe timeout in milliseconds. */
  timeout?: number;
  /** HTTP(S) endpoint to poll. Omit when `probe` is provided. */
  url?: string;
}

export interface WatchHooks {
  /** Edge down -> up, including the very first successful probe. */
  onConnect?: (info: { latencyMs: number; status: number }) => void;
  /** Edge up -> down. Not fired when the very first probe fails. */
  onDisconnect?: (info: { reason: WatchReason; error?: Error }) => void;
  /** Any probe that ends with HTTP 403, before the isUp decision. */
  onForbidden?: (info: { latencyMs: number; status: number }) => void;
  /** Called when a probe finishes with a status present in this map. */
  onStatus?: Record<number, (info: { latencyMs: number; status: number }) => void>;
  /** Every successful probe. */
  onSuccess?: (info: { latencyMs: number; status: number }) => void;
  /** Every failed probe with a classified reason. */
  onError?: (info: { reason: WatchReason; error?: Error }) => void;
}

export interface WatchHandle {
  stop: () => void;
  /** null until the first probe completes. */
  readonly up: boolean | null;
}

/** Result of a single probe run. */
export interface ProbeOutcome {
  error?: Error;
  latencyMs: number;
  ok: boolean;
  status: number;
}

/** The watcher object returned by startWatcher. */
export interface Watcher extends WatchHandle {
  runProbe: () => Promise<void>;
}
