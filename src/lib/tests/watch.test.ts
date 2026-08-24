import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/index.logger";
import { startWatcher } from "@/watch/index.watch";

const noop = (): void => {};
const fakeFetch = (response: Response | Promise<Response>): typeof fetch =>
  Object.assign(() => response, { preconnect: () => {} }) as typeof fetch;

const captureConsole = (): { out: string[]; restore: () => void } => {
  const out: string[] = [];
  const originals = { error: console.error, log: console.log, warn: console.warn };
  const push = (value: unknown): void => {
    out.push(String(value));
  };
  console.error = push;
  console.log = push;
  console.warn = push;
  return {
    out,
    restore: () => {
      console.error = originals.error;
      console.log = originals.log;
      console.warn = originals.warn;
    },
  };
};

const makeLogger = () => createLogger({ settings: { level: "debug", mode: "json" } });

describe("watcher", () => {
  let captured: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    captured = captureConsole();
  });

  afterEach(() => {
    captured.restore();
  });

  test("first success fires hooks and logs a success edge", async () => {
    const connected = Promise.withResolvers<{ latencyMs: number; status: number }>();
    const succeeded = Promise.withResolvers<{ latencyMs: number; status: number }>();
    const logger = makeLogger();
    const watcher = logger.watch(
      { interval: 60_000, probe: () => true },
      {
        onConnect: (info) => connected.resolve(info),
        onSuccess: (info) => succeeded.resolve(info),
      },
    );

    await Promise.all([connected.promise, succeeded.promise]);
    expect(watcher.up).toBe(true);
    expect(captured.out.filter((line) => line.includes("watch connected"))).toHaveLength(1);
    await logger.close();
  });

  test("a failed probe after success fires one disconnect edge", async () => {
    const connected = Promise.withResolvers<null>();
    let healthy = true;
    const disconnects: string[] = [];
    const watcher = startWatcher(
      (level, message) => {
        if (level === "warn") console.warn(message);
      },
      { interval: 60_000, probe: () => healthy },
      {
        onConnect: () => connected.resolve(null),
        onDisconnect: ({ reason }) => disconnects.push(reason),
      },
    );

    await connected.promise;
    healthy = false;
    await watcher.runProbe();
    await watcher.runProbe();

    expect(disconnects).toEqual(["status"]);
    expect(watcher.up).toBe(false);
    expect(captured.out.filter((line) => line.includes("watch disconnected"))).toHaveLength(1);
    watcher.stop();
  });

  test("classifies abort and non-2xx HTTP failures", async () => {
    const originalFetch = globalThis.fetch;
    const reasons: string[] = [];
    const timeoutReason = Promise.withResolvers<string>();
    const statusReason = Promise.withResolvers<string>();
    try {
      globalThis.fetch = fakeFetch(
        Promise.reject<Response>(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
      const timeoutWatcher = startWatcher(noop, { url: "http://localhost/health" }, {
        onError: ({ reason }) => {
          reasons.push(reason);
          timeoutReason.resolve(reason);
        },
      });
      expect(await timeoutReason.promise).toBe("timeout");
      timeoutWatcher.stop();

      globalThis.fetch = fakeFetch(Promise.resolve(new Response(null, { status: 503 })));
      const statusWatcher = startWatcher(noop, { url: "http://localhost/health" }, {
        onError: ({ reason }) => {
          reasons.push(reason);
          statusReason.resolve(reason);
        },
      });
      expect(await statusReason.promise).toBe("status");
      statusWatcher.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(reasons).toEqual(["timeout", "status"]);
  });

  test("classifies DNS and connection refusal errors", async () => {
    const refused = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    const missing = Object.assign(new Error("missing"), { code: "ENOTFOUND" });
    let nextError: Error = refused;
    const reasons: string[] = [];
    const firstError = Promise.withResolvers<string>();
    const watcher = startWatcher(noop, {
      interval: 60_000,
      probe: () => {
        throw nextError;
      },
    }, {
      onError: ({ reason }) => {
        reasons.push(reason);
        if (reasons.length === 1) firstError.resolve(reason);
      },
    });

    expect(await firstError.promise).toBe("refused");
    nextError = missing;
    await watcher.runProbe();
    watcher.stop();

    expect(reasons).toEqual(["refused", "dns"]);
    captured.restore();
  });

  test("stop prevents a scheduled probe from running", async () => {
    let calls = 0;
    const watcher = startWatcher(noop, {
      interval: 60_000,
      probe: () => {
        calls += 1;
        return true;
      },
    });

    await watcher.runProbe();
    watcher.stop();
    const callsAtStop = calls;
    await watcher.runProbe();

    expect(callsAtStop).toBe(2);
    expect(calls).toBe(callsAtStop);
    captured.restore();
  });

  test("declarative settings.watch replaces and clears its watcher", async () => {
    const firstProbe = Promise.withResolvers<boolean>();
    const secondProbe = Promise.withResolvers<boolean>();
    let firstCalls = 0;
    let secondCalls = 0;
    const logger = createLogger({
      settings: {
        level: "debug",
        mode: "json",
        watch: {
          interval: 60_000,
          probe: () => {
            firstCalls += 1;
            return firstProbe.promise;
          },
        },
      },
    });

    firstProbe.resolve(true);
    await Promise.resolve();
    logger.settings({
      watch: {
        interval: 60_000,
        probe: () => {
          secondCalls += 1;
          return secondProbe.promise;
        },
      },
    });
    secondProbe.resolve(true);
    await Promise.resolve();
    logger.settings({ watch: false });

    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
    await logger.close();
  });

  test("module and child loggers do not inherit declarative watchers", async () => {
    let parentCalls = 0;
    let childCalls = 0;
    const logger = createLogger({
      settings: {
        level: "debug",
        mode: "json",
        watch: { interval: 60_000, probe: () => {
          parentCalls += 1;
          return true;
        } },
      },
    });
    const child = logger.module("CHILD");
    child.settings({
      watch: { interval: 60_000, probe: () => {
        childCalls += 1;
        return true;
      } },
    });

    await Promise.resolve();
    expect(parentCalls).toBe(1);
    expect(childCalls).toBe(1);
    await Promise.all([logger.close(), child.close()]);
    captured.restore();
  });

  test("close stops registered watchers", async () => {
    let calls = 0;
    const logger = makeLogger();
    logger.watch({ interval: 60_000, probe: () => {
      calls += 1;
      return true;
    } });

    await Promise.resolve();
    await logger.close();
    const callsAtClose = calls;
    await Promise.resolve();

    expect(callsAtClose).toBe(1);
    expect(calls).toBe(callsAtClose);
  });

  test("requires a URL or a probe", () => {
    const logger = makeLogger();
    expect(() => logger.watch({})).toThrow("requires a url or a probe");
    captured.restore();
  });

  test("custom isUp controls HTTP availability", async () => {
    const originalFetch = globalThis.fetch;
    const statuses: number[] = [];
    globalThis.fetch = fakeFetch(Promise.resolve(new Response(null, { status: 204 })));
    try {
      const watcher = startWatcher(noop, {
        isUp: (status) => status === 204,
        url: "http://localhost/health",
      }, {
        onSuccess: ({ status }) => statuses.push(status),
      });
      await watcher.runProbe();
      watcher.stop();
    } finally {
      globalThis.fetch = originalFetch;
      captured.restore();
    }

    expect(statuses).toEqual([204, 204]);
  });
});
