import { Database } from "bun:sqlite";

import { createLogger } from "../src";
import { createSqliteAdapter } from "../src/transports/sqlite";

interface BenchResult {
  name: string;
  category: string;
  iterations: number;
  runs: number;
  samples: number[];
  medianOpsPerSec: number;
  medianNsPerOp: number;
}

const ITERATIONS = Number(Bun.env.BENCH_ITERATIONS ?? 100_000);
const RUNS = Number(Bun.env.BENCH_RUNS ?? 7);
const OUTPUT_JSON = Bun.env.BENCH_JSON === "1";
const GATE = Bun.env.BENCH_GATE === "1";
const SILENT = Bun.env.BENCH_SILENT !== "0";
const originalConsoleLog = console.log;
if (SILENT) console.log = () => undefined;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const measure = (
  name: string,
  category: string,
  iterations: number,
  run: () => void,
): BenchResult => {
  const samples: number[] = [];
  for (let sample = 0; sample < RUNS; sample++) {
    for (let i = 0; i < Math.min(iterations, 10_000); i++) run();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) run();
    const elapsedMs = Math.max(performance.now() - start, Number.EPSILON);
    samples.push(iterations / (elapsedMs / 1000));
  }
  const medianOpsPerSec = median(samples);
  return {
    category,
    iterations,
    medianNsPerOp: 1_000_000_000 / medianOpsPerSec,
    medianOpsPerSec,
    name,
    runs: RUNS,
    samples,
  };
};

const makeLogger = (
  settings: Parameters<typeof createLogger>[0]["settings"],
) => {
  const logger = createLogger({ settings });
  logger.settings({ file: false });
  return logger;
};

const disabledLogger = makeLogger({
  level: "error",
  mode: "json",
  redactKeys: null,
});
const jsonLogger = makeLogger({
  level: "debug",
  mode: "json",
  redactKeys: null,
});
const prettyLogger = makeLogger({
  level: "debug",
  mode: "pretty",
  colors: false,
  redactKeys: null,
});
const contextLogger = makeLogger({
  level: "debug",
  mode: "json",
  redactKeys: null,
});
const redactionLogger = makeLogger({ level: "debug", mode: "json" });
const childLogger = jsonLogger.child({ service: "bench", version: 1 });
const alsLogger = jsonLogger;

// Keep benchmark output away from console/TTY when BENCH_SILENT is enabled.
const loggers = [
  disabledLogger,
  jsonLogger,
  prettyLogger,
  contextLogger,
  redactionLogger,
  childLogger,
  alsLogger,
];
for (const logger of loggers) logger.settings({ file: false });

const db = new Database(":memory:");
const dbLogger = createLogger({
  settings: {
    database: {
      adapter: createSqliteAdapter(db),
      enabled: true,
      level: "debug",
      maxBufferSize: ITERATIONS + 1,
    },
    file: false,
    level: "debug",
    mode: "json",
  },
});
const dbUnbufferedLogger = createLogger({
  settings: {
    database: {
      adapter: createSqliteAdapter(new Database(":memory:")),
      enabled: true,
      level: "debug",
      // Every entry becomes one sequential adapter.write call.
      maxBufferSize: 1,
    },
    file: false,
    level: "debug",
    mode: "json",
  },
});

const results = [
  measure("disabled lazy write", "disabled", ITERATIONS, () => {
    disabledLogger.debug(
      () => "skipped message",
      () => ({ expensive: true }),
    );
  }),
  measure("json write", "json", ITERATIONS, () => {
    jsonLogger.info("message");
  }),
  measure("pretty renderer", "pretty", ITERATIONS, () => {
    prettyLogger.info("message");
  }),
  measure("json with context", "context", ITERATIONS, () => {
    contextLogger.info("message", { userId: 42, path: "/x" });
  }),
  measure("json with redaction", "redaction", ITERATIONS, () => {
    redactionLogger.info("message", {
      userId: 42,
      authorization: "Bearer secret-token",
    });
  }),
  measure("child logger", "child", ITERATIONS, () => {
    childLogger.info("message", { requestId: "req-1" });
  }),
  measure("async-local context", "als", ITERATIONS, () => {
    alsLogger.run({ requestId: "req-1" }, () => alsLogger.info("message"));
  }),
  measure(
    "sqlite buffered pipeline",
    "database",
    Math.max(1_000, Math.floor(ITERATIONS / 10)),
    () => {
      dbLogger.info("message", { userId: 42 });
    },
  ),
  measure(
    "sqlite flush per entry",
    "database-pipeline",
    Math.max(1_000, Math.floor(ITERATIONS / 10)),
    () => {
      dbUnbufferedLogger.info("message", { userId: 42 });
    },
  ),
];

const thresholds: Record<string, number> = {
  disabled: Number(Bun.env.BENCH_GATE_DISABLED ?? 10_000_000),
  json: Number(Bun.env.BENCH_GATE_JSON ?? 1_000_000),
};
const failures = results.filter((result) => {
  const threshold = thresholds[result.category];
  return GATE && threshold !== undefined && result.medianOpsPerSec < threshold;
});

if (SILENT) console.log = originalConsoleLog;
if (OUTPUT_JSON) {
  console.log(
    JSON.stringify({ iterations: ITERATIONS, results, runs: RUNS }, null, 2),
  );
} else {
  const width = Math.max(...results.map((result) => result.name.length));
  console.log(`\nhp_logger benchmark matrix (${RUNS} runs, median)\n`);
  for (const result of results) {
    const padded = result.name.padEnd(width);
    console.log(
      `${padded}  ${Math.trunc(result.medianOpsPerSec).toLocaleString()} ops/s  ${result.medianNsPerOp.toFixed(1)} ns/op`,
    );
  }
  if (GATE) {
    console.log(
      failures.length === 0
        ? "\nperformance gates: PASS"
        : `\nperformance gates: FAIL (${failures.map((r) => r.name).join(", ")})`,
    );
  }
}

await Promise.all(loggers.map((logger) => logger.close()));
await dbLogger.close();
await dbUnbufferedLogger.close();
db.close();

if (failures.length > 0) process.exitCode = 1;
