import { describe, expect, test } from 'bun:test';

import { Elysia } from 'elysia';

import { createLogger } from '../logger';
import { elysiaPlugin } from './elysia';

describe('elysia integration', () => {
  test('plugin logs requests with status', async () => {
    const logger = createLogger({
      settings: { filters: [() => true], level: 'debug' },
    });
    const app = new Elysia()
      .use(elysiaPlugin(logger, { skipPaths: ['/health'] }))
      .get('/', () => 'ok')
      .get('/health', () => ({ ok: true }));

    const res = await app.handle(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('plugin skips configured paths from logging', async () => {
    const entries: string[] = [];
    const logger = createLogger({
      settings: {
        filters: [(entry) => {
          entries.push(entry.message);
          return true;
        }],
        level: 'debug',
      },
    });
    const app = new Elysia()
      .use(elysiaPlugin(logger, { skipPaths: ['/health'] }))
      .get('/', () => 'ok')
      .get('/health', () => ({ ok: true }));

    await app.handle(new Request('http://localhost/'));
    await app.handle(new Request('http://localhost/health'));

    expect(entries.filter((m) => m === 'request').length).toBe(1);
  });
});
