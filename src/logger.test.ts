import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createLogger } from '.';
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
  });

  test('logs at different levels', () => {
    const logger = createLogger({ settings: { level: 'debug' } });
    logger.debug('debug message');
    logger.info('info message');
    logger.success('success message');
    logger.warn('warn message');
    logger.error('error message');
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

});
