import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { WatchOptions } from '../types';
import { createLogger } from '../logger';
import { startWatcher } from '../watch';

const sleep = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

const noop = (): void => {};

const captureConsole = (): {
  out: string[];
  restore: () => void;
} => {
  const out: string[] = [];
  const originals = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const push = (value: unknown) => {
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

const makeLogger = () =>
  createLogger({ settings: { level: 'debug', mode: 'json' } });

describe('watcher', () => {
  let captured: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    captured = captureConsole();
  });

  afterEach(() => {
    captured.restore();
  });

  test('first success fires onConnect, onSuccess and logs a success line', async () => {
    const events: string[] = [];
    const logger = makeLogger();
    logger.watch(
      { probe: () => true },
      {
        onConnect: () => events.push('connect'),
        onSuccess: ({ latencyMs }) => events.push(`ok:${latencyMs >= 0}`),
      }
    );
    await sleep(20);
    expect(events).toEqual(['connect', 'ok:true']);
    expect(captured.out.some((line) => line.includes('watch connected'))).toBe(true);
    await logger.close();
  });

  test('failure after success fires onDisconnect once and logs warn', async () => {
    let healthy = true;
    const disconnects: string[] = [];
    const logger = makeLogger();
    const hooked = logger.watch(
      { intervalMs: 5, probe: () => healthy },
      {
        onDisconnect: ({ reason }) => disconnects.push(reason),
      }
    );
    await sleep(30);
    healthy = false;
    await sleep(30);
    expect(disconnects).toEqual(['status']);
    expect(hooked.up).toBe(false);
    expect(
      captured.out.some((line) => line.includes('watch disconnected'))
    ).toBe(true);
    await logger.close();
  });

  test('classifies abort as timeout', async () => {
    const reasons: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(
        Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
        })
      )) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      logger.watch(
        { url: 'http://localhost:1/health' },
        { onError: ({ reason }) => reasons.push(reason) }
      );
      await sleep(20);
      expect(reasons).toEqual(['timeout']);
      await logger.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('classifies non-2xx responses as status', async () => {
    const reasons: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 503 }))) as unknown as typeof fetch;
    try {
      const logger = makeLogger();
      logger.watch(
        { url: 'http://localhost:1/health' },
        { onError: ({ reason }) => reasons.push(reason) }
      );
      await sleep(20);
      expect(reasons).toEqual(['status']);
      await logger.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('classifies connection errors by code', async () => {
    const reasons: string[] = [];
    const refused = Object.assign(new Error('refused'), {
      code: 'ECONNREFUSED',
    });
    const missing = Object.assign(new Error('missing'), { code: 'ENOTFOUND' });
    const logger = makeLogger();
    let flip = false;
    logger.watch(
      {
        intervalMs: 5,
        probe: () => {
          throw flip ? missing : refused;
        },
      },
      {
        onError: ({ reason }) => reasons.push(reason),
      }
    );
    await sleep(40);
    flip = true;
    await sleep(30);
    await logger.close();
    expect(reasons).toContain('refused');
    expect(reasons).toContain('dns');
  });

  test('stop prevents further probes', async () => {
    let calls = 0;
    const watcher = startWatcher(noop, {
      intervalMs: 5,
      probe: () => {
        calls += 1;
        return true;
      },
    });
    await sleep(25);
    watcher.stop();
    const afterStop = calls;
    await sleep(25);
    expect(afterStop).toBeGreaterThan(0);
    expect(calls).toBe(afterStop);
  });

  test('declarative settings.watch starts and is replaced by patches', async () => {
    let aCalls = 0;
    let bCalls = 0;
    const logger = createLogger({
      settings: {
        level: 'debug',
        mode: 'json',
        watch: {
          intervalMs: 5,
          probe: () => {
            aCalls += 1;
            return true;
          },
        },
      },
    });
    await sleep(25);
    expect(aCalls).toBeGreaterThan(0);

    logger.settings({
      watch: {
        intervalMs: 5,
        probe: () => {
          bCalls += 1;
          return true;
        },
      },
    });
    const aAtSwap = aCalls;
    await sleep(25);
    expect(bCalls).toBeGreaterThan(0);
    expect(aCalls).toBe(aAtSwap);

    logger.settings({ watch: false });
    const bAtStop = bCalls;
    await sleep(25);
    expect(bCalls).toBe(bAtStop);
    await logger.close();
  });

  test('module and child loggers do not inherit declarative watchers', async () => {
    let healthy = true;
    const logger = createLogger({
      settings: {
        level: 'debug',
        mode: 'json',
        watch: {
          intervalMs: 5,
          probe: () => healthy,
        },
      },
    });
    const child = logger.module('CHILD');
    child.settings({
      watch: {
        intervalMs: 5,
        probe: () => false,
      },
    });
    await sleep(30);
    const disconnectsBefore = captured.out.filter((line) =>
      line.includes('watch disconnected')
    ).length;
    healthy = false;
    await sleep(30);
    const disconnectsAfter =
      captured.out.filter((line) => line.includes('watch disconnected'))
        .length - disconnectsBefore;
    expect(disconnectsAfter).toBe(1);
    await Promise.all([logger.close(), child.close()]);
  });

  test('close stops every registered watcher', async () => {
    let calls = 0;
    const options: WatchOptions = {
      intervalMs: 5,
      probe: () => {
        calls += 1;
        return true;
      },
    };
    const logger = makeLogger();
    logger.watch(options);
    logger.watch(options);
    await sleep(25);
    await logger.close();
    const atClose = calls;
    await sleep(25);
    expect(calls).toBe(atClose);
  });

  test('requires a url or a probe', () => {
    const logger = makeLogger();
    expect(() => logger.watch({})).toThrow('requires a url or a probe');
  });

  test('startWatcher exposes up state transitions', async () => {
    let healthy = true;
    const watcher = startWatcher(noop, {
      intervalMs: 5,
      probe: () => healthy,
    });
    await sleep(10);
    expect(watcher.up).toBe(true);
    healthy = false;
    await sleep(15);
    expect(watcher.up).toBe(false);
    watcher.stop();
  });
});
