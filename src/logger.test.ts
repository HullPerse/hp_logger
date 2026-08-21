import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { LogEntry, Transport } from './types';
import { createLogger, Logger } from '.';
import { resolveEnvLevel, redact } from './utils';

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('creates logger with default options', () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.module).toBe('function');
    expect(typeof logger.settings).toBe('function');
    expect(typeof logger.close).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.measure).toBe('function');
    expect(typeof logger.once).toBe('function');
    expect(typeof logger.throttle).toBe('function');
    expect(typeof logger.run).toBe('function');
  });

  test('logs at different levels', () => {
    const logger = createLogger({ settings: { level: 'trace' } });
    logger.trace('trace message');
    logger.debug('debug message');
    logger.info('info message');
    logger.success('success message');
    logger.warn('warn message');
    logger.error('error message');
    logger.fatal('fatal message');
  });

  test('respects log level', () => {
    const logger = createLogger({ settings: { level: 'warn' } });
    logger.debug('debug message');
    logger.info('info message');
    logger.success('success message');
    logger.warn('warn message');
    logger.error('error message');
  });

  test('module inherits settings and can override', () => {
    const logger = createLogger({ settings: { level: 'warn' } });
    const auth = logger.module('auth', { level: 'debug' });
    expect(auth).toBeDefined();
    auth.debug('should log');
    auth.info('should log');
  });

  test('module without override inherits global level', () => {
    const logger = createLogger({ settings: { level: 'warn' } });
    const moduleLogger = logger.module('auth');
    moduleLogger.debug('should not log');
    moduleLogger.warn('should log');
  });

  test('child logger inherits context', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    const child = logger.module('auth').child({ requestId: '123' });
    expect(child).toBeDefined();
    child.info('child message');
  });

  test('settings() can be applied after creation', () => {
    const logger = createLogger();
    logger.settings({ level: 'warn' });
    logger.debug('should not log');
    logger.warn('should log');
  });

  test('redacts sensitive data', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    logger.info('user login', { normal: 'value', password: 'secret123', token: 'abc' });
  });

  test('redacts bearer tokens', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    logger.info('auth', { auth: 'Bearer secret-token-here' });
  });

  test('addContext adds persistent context', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    logger.addContext({ service: 'api' });
    logger.info('with context');
  });

  test('event method logs with event name', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    logger.event('info', 'user_action', { action: 'click' });
  });

  test('createLogger with async transport', async () => {
    const logger = createLogger({
      settings: {
        async: { batchSize: 10, flushIntervalMs: 100 },
        level: 'debug',
      },
    });
    logger.info('async message');
    logger.debug('another message');
    await logger.close();
  });

  test('createLogger with json mode', () => {
    const logger = createLogger({ settings: { level: 'debug', mode: 'json' } });
    logger.info('json message', { key: 'value' });
  });

  test('colors can be disabled', () => {
    const logger = createLogger({ settings: { colors: false, level: 'debug' } });
    logger.info('plain message');
  });

  test('colors can be overridden', () => {
    const logger = createLogger({
      settings: { colors: { info: 'cyan' }, level: 'debug' },
    });
    logger.info('cyan info');
  });

  test('file transport can be enabled', async () => {
    const logger = createLogger({
      settings: {
        file: { enabled: true, path: '/tmp/hp-logger-test.log' },
        level: 'debug',
      },
    });
    logger.info('file message');
    await logger.close();
    const content = await Bun.file('/tmp/hp-logger-test.log').text();
    expect(content).toContain('file message');
    await Bun.$`rm -f /tmp/hp-logger-test.log`;
  });

  test('filters can drop entries', () => {
    const logger = createLogger({
      settings: {
        filters: [(entry) => entry.message !== 'hidden'],
        level: 'debug',
      },
    });
    logger.info('hidden');
    logger.info('visible');
  });

  test('redact serializes Error with name, message and stack', () => {
    const result = redact(new Error('boom'), /secret/iu);
    expect(result).toEqual({
      message: 'boom',
      name: 'Error',
      stack: expect.stringContaining('boom'),
    });
  });

  test('redact serializes nested Error in context', () => {
    const result = redact(
      { error: new Error('query failed'), source: 'db' },
      /secret/iu
    );
    expect(result).toEqual({
      error: {
        message: 'query failed',
        name: 'Error',
        stack: expect.stringContaining('query failed'),
      },
      source: 'db',
    });
  });

  test('redact does not truncate strings', () => {
    const long = 'x'.repeat(5000);
    const result = redact(long, /secret/iu);
    expect(result).toBe(long);
  });

  test('enabled false skips all entries', async () => {
    const logger = createLogger({
      settings: {
        enabled: false,
        file: { enabled: true, path: '/tmp/hp-logger-disabled.log' },
        level: 'debug',
      },
    });
    logger.info('should not appear');
    await logger.close();
    expect(await Bun.file('/tmp/hp-logger-disabled.log').exists()).toBe(false);
  });

  test('file mode pretty writes readable lines', async () => {
    const logger = createLogger({
      settings: {
        file: { enabled: true, mode: 'pretty', path: '/tmp/hp-logger-pretty.log' },
        level: 'debug',
      },
    });
    logger.info('hello pretty');
    await logger.close();
    const content = await Bun.file('/tmp/hp-logger-pretty.log').text();
    expect(content).toContain('[INFO]');
    expect(content).toContain('hello pretty');
    expect(content).not.toContain('"level"');
    await Bun.$`rm -f /tmp/hp-logger-pretty.log`;
  });

  test('redactDepth limits nested context serialization', () => {
    const logger = createLogger({
      settings: { level: 'debug', redactDepth: 1 },
    });
    logger.info('deep context', { outer: { inner: { deepest: 'x' } } });
  });

  test('showLevel renders level prefix in pretty output', () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: { colors: false, level: 'info', mode: 'pretty', showLevel: true },
      });
      logger.info('hello level');
    } finally {
      console.log = original;
    }
    expect(outputs.some((out) => out.includes('[INFO]'))).toBe(true);
  });

  test('formatContext kv renders key="value" pairs in pretty output', () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: {
          colors: false,
          formatContext: 'kv',
          level: 'info',
          mode: 'pretty',
        },
      });
      logger.info('hello ctx', { name: 'vasya', userId: 42 });
    } finally {
      console.log = original;
    }
    expect(outputs.some((out) => out.includes('name="vasya" userId=42'))).toBe(true);
    expect(outputs.some((out) => out.includes('{"name"'))).toBe(false);
  });

  test('formatContext json is default', () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: { colors: false, level: 'info', mode: 'pretty' },
      });
      logger.info('hello ctx', { userId: 42 });
    } finally {
      console.log = original;
    }
    expect(outputs.some((out) => out.includes('{"userId":42}'))).toBe(true);
  });

  test('showLevel false hides level prefix', () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({
        settings: { colors: false, level: 'info', mode: 'pretty' },
      });
      logger.info('hello no level');
    } finally {
      console.log = original;
    }
    expect(outputs.some((out) => out.includes('[INFO]'))).toBe(false);
  });

  test('settings can toggle enabled after creation', async () => {
    const logger = createLogger({
      settings: {
        file: { enabled: true, path: '/tmp/hp-logger-toggle.log' },
        level: 'debug',
      },
    });
    logger.settings({ enabled: false });
    logger.info('suppressed');
    logger.settings({ enabled: true });
    logger.info('visible again');
    await logger.close();
    const content = await Bun.file('/tmp/hp-logger-toggle.log').text();
    expect(content).toContain('visible again');
    expect(content).not.toContain('suppressed');
    await Bun.$`rm -f /tmp/hp-logger-toggle.log`;
  });

  test('resolveEnvLevel reads LOG_LEVEL from env', () => {
    expect(resolveEnvLevel({ LOG_LEVEL: 'warn' })).toBe('warn');
    expect(resolveEnvLevel({ LOG_LEVEL: 'debug' })).toBe('debug');
    expect(resolveEnvLevel({})).toBe('info');
    expect(resolveEnvLevel({ LOG_LEVEL: 'bogus' })).toBe('info');
  });

  test('createLogger uses LOG_LEVEL from env when level is not set', () => {
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    try {
      const logger = createLogger();
      expect(logger).toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = previous;
    }
  });
  test('daily rotation shares one file per day between loggers', async () => {
    const dir = `/tmp/hp-logger-shared-${Date.now()}`;
    const a = createLogger({
      settings: {
        file: { enabled: true, path: dir, rotation: 'daily' },
        level: 'debug',
      },
    });
    const b = createLogger({
      settings: {
        file: { enabled: true, path: dir, rotation: 'daily' },
        level: 'debug',
      },
    });
    a.info('from logger a');
    b.info('from logger b');
    await a.close();
    await b.close();
    const [dateStr] = new Date().toISOString().split('T');
    const dateDir = `${dir}/${dateStr}`;
    const lsOutput = await Bun.$`ls ${dateDir}`.text();
    const files = lsOutput.trim().split('\n');
    expect(files.filter((f) => f.startsWith('log_'))).toHaveLength(1);
    const content = await Bun.file(`${dateDir}/${files[0]}`).text();
    expect(content).toContain('from logger a');
    expect(content).toContain('from logger b');
    await Bun.$`rm -rf ${dir}`;
  });

  test('lazy message and context are not evaluated when level is disabled', () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    let evaluated = 0;
    try {
      const logger = createLogger({ settings: { level: 'info', mode: 'json' } });
      logger.debug(() => {
        evaluated += 1;
        return 'lazy debug message';
      }, () => {
        evaluated += 1;
        return { expensive: evaluated };
      });
      logger.info(() => {
        evaluated += 1;
        return 'lazy info message';
      });
    } finally {
      console.log = original;
    }
    // only the info thunk runs
    expect(evaluated).toBe(1);
    expect(outputs.some((out) => out.includes('lazy info message'))).toBe(true);
    expect(outputs.some((out) => out.includes('lazy debug message'))).toBe(false);
  });

  test('measure logs duration and returns the result', async () => {
    const result = await createLogger({ settings: { level: 'debug', mode: 'json' } }).measure(
      'db.query',
      () => 42
    );
    expect(result).toBe(42);
  });

  test('once logs a key only once', () => {
    const outputs: string[] = [];
    const original = console.warn;
    console.warn = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({ settings: { level: 'debug', mode: 'json' } });
      logger.once('db-down', 'database down');
      logger.once('db-down', 'database down again');
      logger.once('other-key', 'other event');
    } finally {
      console.warn = original;
    }
    expect(outputs.filter((out) => out.includes('database down')).length).toBe(1);
    expect(outputs.filter((out) => out.includes('other event')).length).toBe(1);
  });

  test('throttle drops calls within the interval', () => {
    const outputs: string[] = [];
    const original = console.warn;
    console.warn = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({ settings: { level: 'debug', mode: 'json' } });
      logger.throttle('conn', 10_000, 'connection failed');
      logger.throttle('conn', 10_000, 'connection failed again');
      logger.throttle('other', 10_000, 'other failure');
    } finally {
      console.warn = original;
    }
    expect(outputs.filter((out) => out.includes('connection failed')).length).toBe(1);
    expect(outputs.filter((out) => out.includes('other failure')).length).toBe(1);
  });

  test('run merges async-local context into entries', async () => {
    const outputs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => {
      outputs.push(String(value));
    };
    try {
      const logger = createLogger({ settings: { level: 'debug', mode: 'json' } });
      await logger.run({ requestId: 'abc' }, async () => {
        logger.info('inside run');
        await Bun.sleep(1);
        logger.info('still inside run');
      });
      logger.info('outside run');
    } finally {
      console.log = original;
    }
    const inside = outputs.filter((out) => out.includes('requestId'));
    expect(inside).toHaveLength(2);
    expect(outputs.some((out) => out.includes('outside run') && !out.includes('requestId'))).toBe(true);
  });

  test('fatal and trace levels render and respect ordering', () => {
    const outputs: string[] = [];
    const original = console.log;
    const originalError = console.error;
    console.log = (value: unknown) => {
      outputs.push(`log:${String(value)}`);
    };
    console.error = (value: unknown) => {
      outputs.push(`error:${String(value)}`);
    };
    try {
      const logger = createLogger({ settings: { level: 'trace', mode: 'json' } });
      logger.trace('trace me');
      logger.fatal('fatal me');
      const filtered = createLogger({ settings: { level: 'error', mode: 'json' } });
      filtered.trace('hidden trace');
      filtered.debug('hidden debug');
      filtered.fatal('kept fatal');
    } finally {
      console.log = original;
      console.error = originalError;
    }
    expect(outputs.some((out) => out.includes('trace me'))).toBe(true);
    expect(outputs.some((out) => out.includes('fatal me') && out.startsWith('error:'))).toBe(true);
    expect(outputs.some((out) => out.includes('hidden trace'))).toBe(false);
    expect(outputs.some((out) => out.includes('kept fatal'))).toBe(true);
  });

  test('addTransport writes to global transports for every logger', () => {
    const received: LogEntry[] = [];
    const transport: Transport = {
      write(entry: LogEntry) {
        received.push(entry);
      },
    };
    Logger.addTransport(transport);
    try {
      const logger = createLogger({ settings: { level: 'debug', mode: 'json' } });
      logger.info('hello global');
    } finally {
      Logger.removeTransport(transport);
    }
    expect(received.some((entry) => entry.message === 'hello global')).toBe(true);
  });

});
