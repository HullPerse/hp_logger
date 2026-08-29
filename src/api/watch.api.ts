import { startWatcher } from "../watch/index.watch";
import type { WatchHandle, WatchHooks, WatchOptions } from "../types/watch";

export const watchImpl = (
  logger: unknown,
  options: WatchOptions,
  hooks: WatchHooks = {},
): WatchHandle => {
  const self = logger as {
    success: (msg: string, ctx: Record<string, unknown>) => void;
    warn: (msg: string, ctx: Record<string, unknown>) => void;
    debug: (msg: string, ctx: Record<string, unknown>) => void;
    watchHandles: WatchHandle[];
  };
  const handle = startWatcher(
    (level, message, context) => {
      if (level === "success") self.success(message, context);
      else if (level === "warn") self.warn(message, context);
      else self.debug(message, context);
    },
    options,
    hooks,
  );
  self.watchHandles.push(handle);
  return handle;
};

export const rebindWatchImpl = (logger: unknown, config: WatchOptions | false): void => {
  const self = logger as {
    declarativeWatch: WatchHandle | null;
    watchHandles: WatchHandle[];
    watch: (opts: WatchOptions) => WatchHandle;
  };
  if (self.declarativeWatch) {
    const index = self.watchHandles.indexOf(self.declarativeWatch);
    if (index !== -1) self.watchHandles.splice(index, 1);
    self.declarativeWatch.stop();
    self.declarativeWatch = null;
  }
  if (config && (config.url || config.probe)) {
    self.declarativeWatch = watchImpl(logger, config);
  }
};
