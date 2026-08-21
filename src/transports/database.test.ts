import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { createLogger } from '../logger';
import { createSqliteAdapter } from './sqlite';

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
