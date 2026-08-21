import { Database } from 'bun:sqlite';

import { createLogger } from '../src';
import { createSqliteAdapter } from '../src/transports/sqlite';

interface BenchResult {
  name: string;
  opsPerSec: number;
  nsPerOp: number;
}

const measure = (name: string, iterations: number, run: () => void): BenchResult => {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 10_000); i++) run();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) run();
  const elapsedMs = performance.now() - start;
  return {
    name,
    nsPerOp: (elapsedMs * 1_000_000) / iterations,
    opsPerSec: Math.trunc(iterations / (elapsedMs / 1000)),
  };
};

const ITERATIONS = 200_000;

const jsonLogger = createLogger({
  settings: { file: false, level: 'debug', mode: 'json' },
});
const prettyLogger = createLogger({
  settings: { file: false, level: 'debug', mode: 'pretty' },
});
const asyncLogger = createLogger({
  settings: {
    async: { batchSize: 500, flushIntervalMs: 50 },
    file: false,
    level: 'debug',
    mode: 'json',
  },
});
const disabledLogger = createLogger({
  settings: { file: false, level: 'error', mode: 'json' },
});

const db = new Database(':memory:');
const dbLogger = createLogger({
  settings: {
    database: { adapter: createSqliteAdapter(db), enabled: true, level: 'debug' },
    file: false,
    level: 'debug',
    mode: 'json',
  },
});

const results = [
  measure('disabled lazy write', ITERATIONS, () => {
    disabledLogger.debug(() => 'skipped message', () => ({ expensive: true }));
  }),
  measure('json write', ITERATIONS, () => {
    jsonLogger.info('message', { userId: 42, path: '/x' });
  }),
  measure('pretty write', ITERATIONS, () => {
    prettyLogger.info('message', { userId: 42, path: '/x' });
  }),
  measure('async json write', ITERATIONS, () => {
    asyncLogger.info('message', { userId: 42, path: '/x' });
  }),
  measure('sqlite db write', 20_000, () => {
    dbLogger.info('message', { userId: 42, path: '/x' });
  }),
];

const width = Math.max(...results.map((r) => r.name.length));
console.log('\nhp_logger benchmarks\n');
for (const result of results) {
  const padded = result.name.padEnd(width);
  console.log(`${padded}  ${result.opsPerSec.toLocaleString()} ops/s  ${result.nsPerOp.toFixed(1)} ns/op`);
}

await Promise.all([
  jsonLogger.close(),
  prettyLogger.close(),
  asyncLogger.close(),
  dbLogger.close(),
]);
db.close();
