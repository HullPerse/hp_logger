import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { createLogger } from '../logger';
import type { LogEntry } from '../types';
import { DatabaseTransport } from './database';
import { createSqliteAdapter } from './sqlite';

const entry = (message: string): LogEntry => ({
  author: 'TEST',
  context: {},
  level: 'info',
  message,
  timestamp: message,
});

describe('DatabaseTransport', () => {
  test('persists entries through the sqlite adapter', async () => {
    const db = new Database(':memory:');
    const logger = createLogger({
      settings: {
        database: {
          adapter: createSqliteAdapter(db),
          enabled: true,
          level: 'debug',
        },
        file: false,
        level: 'debug',
        mode: 'json',
      },
    });

    logger.info('hello db', { userId: 42 });
    logger.warn('careful', { path: '/x' });
    await logger.close();

    const rows = db.query('SELECT * FROM logs ORDER BY id').all() as {
      author: string;
      context: string;
      level: string;
      message: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ author: 'ROOT', level: 'info', message: 'hello db' });
    expect(JSON.parse(rows[0].context)).toEqual({ userId: 42 });
    expect(rows[1].level).toBe('warn');
  });

  test('level filter drops entries below the configured level', async () => {
    const db = new Database(':memory:');
    const logger = createLogger({
      settings: {
        database: {
          adapter: createSqliteAdapter(db),
          enabled: true,
          level: 'warn',
        },
        file: false,
        level: 'debug',
        mode: 'json',
      },
    });

    logger.debug('hidden');
    logger.info('hidden too');
    logger.warn('kept');
    logger.error('kept too');
    await logger.close();

    const rows = db.query('SELECT * FROM logs ORDER BY id').all() as { level: string }[];
    expect(rows.map((row) => row.level)).toEqual(['warn', 'error']);
  });

  test('serializes overlapping flushes and preserves FIFO order', async () => {
    const writes: string[][] = [];
    const firstWrite = Promise.withResolvers<null>();
    const adapter = {
      async write(entries: LogEntry[]) {
        writes.push(entries.map((item) => item.message));
        if (writes.length === 1) await firstWrite.promise;
      },
    };
    const transport = new DatabaseTransport({
      adapter,
      enabled: true,
      flushIntervalMs: 60_000,
      maxBufferSize: 1,
    });

    transport.write(entry('first'));
    transport.write(entry('second'));
    const closing = transport.close();
    await Promise.resolve();
    expect(writes).toEqual([['first']]);
    firstWrite.resolve(null);
    await closing;
    expect(writes).toEqual([['first'], ['second']]);
  });

  test('close waits for an in-flight batch before closing the adapter', async () => {
    const writeStarted = Promise.withResolvers<null>();
    let closed = false;
    const transport = new DatabaseTransport({
      adapter: {
        close() {
          closed = true;
        },
        async write() {
          await writeStarted.promise;
        },
      },
      enabled: true,
      flushIntervalMs: 60_000,
      maxBufferSize: 1,
    });
    transport.write(entry('entry'));
    const closing = transport.close();
    await Promise.resolve();
    expect(closed).toBe(false);
    writeStarted.resolve(null);
    await closing;
    expect(closed).toBe(true);
  });

  test('a failing write keeps its batch and later writes stay ordered', async () => {
    const calls: string[][] = [];
    const rows: string[] = [];
    let failFirstCall = true;
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          calls.push(entries.map((item) => item.message));
          if (failFirstCall) {
            failFirstCall = false;
            throw new Error('disk full');
          }
          for (const item of entries) rows.push(item.message);
        },
      },
      enabled: true,
      flushIntervalMs: 60_000,
      maxBufferSize: 2,
    });

    transport.write(entry('a1'));
    transport.write(entry('a2'));
    transport.write(entry('b1'));
    await transport.close();

    expect(calls).toHaveLength(3);
    expect(rows).toEqual(['a1', 'a2', 'b1']);
  });

  test('batches never exceed maxBufferSize', async () => {
    const sizes: number[] = [];
    const transport = new DatabaseTransport({
      adapter: {
        write(entries) {
          sizes.push(entries.length);
        },
      },
      enabled: true,
      flushIntervalMs: 60_000,
      maxBufferSize: 2,
    });

    for (let i = 0; i < 5; i += 1) transport.write(entry(`m${i}`));
    await transport.close();
    expect(sizes).toEqual([2, 2, 1]);
  });

  test('close finishes despite a persistently failing adapter', async () => {
    let closeCalled = false;
    const transport = new DatabaseTransport({
      adapter: {
        close() {
          closeCalled = true;
        },
        write() {
          throw new Error('always fails');
        },
      },
      enabled: true,
      flushIntervalMs: 60_000,
      maxBufferSize: 10,
    });

    transport.write(entry('lost'));
    await transport.close();
    expect(closeCalled).toBe(true);
  });

  test('disabled database settings create no transport', () => {
    const logger = createLogger({
      settings: {
        database: false,
        file: false,
        mode: 'json',
      },
    });
    logger.info('no db');
    expect(logger).toBeDefined();
  });

  test('enabled database without adapter throws', () => {
    expect(() =>
      createLogger({
        settings: {
          database: { enabled: true },
          file: false,
          mode: 'json',
        },
      })
    ).toThrow('requires an adapter');
  });
});
