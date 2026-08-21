# hp_logger

Structured logger for Bun/Node: levels, redaction, configurable colors, file output, global and per-module settings, and server framework integrations.

## Installation

```bash
bun add hp_logger
# or
npm install hp_logger
```

## Quick start

```ts
import { createLogger } from "hp_logger";

const logger = createLogger({
  settings: {
    level: "info",
    mode: "pretty",
  },
});

// module with its own settings
const auth = logger.module("auth", { level: "debug" });

auth.info("user registered", { userId: 42 });
```

## Settings

Global settings are passed to `createLogger`; module settings via `.module(name, settings)` or changed at runtime via `.settings(patch)`.

| Setting | Description | Default |
| --- | --- | --- |
| `level` | Minimum level: debug, info, success, warn, error | `info` (or `LOG_LEVEL` env var) |
| `mode` | `pretty` colored output or `json` structured | `pretty` |
| `colors` | Per-level colors or `false` to disable all | standard |
| `enabled` | Master switch: `false` skips all entries | `true` |
| `redactKeys` | Regex of keys to redact | standard (password, token, etc.) |
| `redactDepth` | Max context nesting depth when redacting | `2` |
| `maxMessageLength` | Message truncation length | `2000` |
| `showTimestamp` | Show time in pretty output | `true` |
| `showAuthor` | Show module name in pretty output | `true` |
| `showLevel` | Colored level prefix `[INFO]`/`[ERROR]` in pretty output | `false` |
| `formatContext` | Context rendering in pretty output: `json` object or `kv` pairs `key="value"` | `json` |
| `formatTimestamp` | `iso` or `local` time format | `iso` |
| `file` | File output: `{ enabled, path, mode, rotation, ... }` or `false` | `false` |
| `async` | Async batched writes or `false` | `false` |
| `filters` | Entry filter functions | `[]` |

### Colors

```ts
const logger = createLogger({
  settings: {
    colors: {
      info: "cyan",      // change a color
      error: "red",
      warn: false,        // disable color for warn
    },
  },
});
```

All colors can be disabled with `colors: false`.

### File output

```ts
const logger = createLogger({
  settings: {
    file: {
      enabled: true,
      path: "logs/app.log",      // or "logs" with rotation: "daily"
      mode: "json",              // "json" by default or "pretty" (readable text without colors)
      rotation: "daily",         // files by day: logs/{yyyy-mm-dd}/log_NNN.log
      // one file per day shared by all loggers with the same path (process-wide)
      flushIntervalMs: 1000,
      maxBufferSize: 100,
    },
  },
});
```

### Database output

Persist entries to a database through an adapter. The package stays zero-dependency: you pass your own adapter, and a ready-made `createSqliteAdapter` (built on `bun:sqlite`) is included.

```ts
import { Database } from "bun:sqlite";
import { createLogger } from "hp_logger";
import { createSqliteAdapter } from "hp_logger";

const db = new Database("logs.sqlite");

const logger = createLogger({
  settings: {
    database: {
      adapter: createSqliteAdapter(db), // creates table `logs` if missing
      enabled: true,
      level: "warn",                    // persist only warn/error
    },
  },
});
```

- `createSqliteAdapter(db, { table? })` - adapter for `bun:sqlite` with batched inserts inside a transaction. The caller owns the `Database` instance.
- Any other database works through a `DatabaseAdapter`: `{ write(entries), close?() }`.
- `level` filters what gets persisted; entries are buffered and flushed on `maxBufferSize` or `flushIntervalMs`.
- Disable with `database: false`.

### Context format

```ts
const logger = createLogger({
  settings: {
    formatContext: "kv", // userId=42 name="vasya" instead of {"userId":42,"name":"vasya"}
  },
});
```

Applies both to console pretty output and file `mode: "pretty"`.

### Level prefix

```ts
const logger = createLogger({
  settings: {
    showLevel: true, // [INFO] [auth] message
  },
});
```

The level is written in its own level color (info - blue, error - red, etc.).

### Modules and context

```ts
const logger = createLogger({ settings: { level: "info" } });

const http = logger.module("http");                       // inherits global
const auth = logger.module("auth", { level: "debug" });   // overrides
const child = auth.child({ requestId: "abc" });           // extra context

logger.settings({ level: "warn" });                       // change at runtime
```

## Integrations

All integrations log requests: method, path, status, duration, correlation id. The level depends on the status: 2xx/3xx info, 4xx warn, 5xx error. `/health` and `/metrics` can be excluded via `skipPaths`.

### Elysia

```ts
import { Elysia } from "elysia";
import { createLogger } from "hp_logger";
import { elysiaPlugin } from "hp_logger/elysia";

const logger = createLogger({ settings: { level: "debug" } });

const app = new Elysia()
  .use(elysiaPlugin(logger, { skipPaths: ["/health", "/metrics"] }))
  .get("/", () => "ok");
```

### Bun.serve

```ts
import { createLogger } from "hp_logger";
import { bunServe } from "hp_logger/bun";

const logger = createLogger();

Bun.serve({
  fetch: bunServe(async (request) => {
    return new Response("ok");
  }, logger),
});
```

### Node http

```ts
import { createServer } from "node:http";
import { createLogger } from "hp_logger";
import { nodeServer } from "hp_logger/node";

const logger = createLogger();

createServer(
  nodeServer((request, response) => {
    response.end("ok");
  }, logger)
).listen(3000);
```

### Hono

```ts
import { Hono } from "hono";
import { createLogger } from "hp_logger";
import { honoMiddleware } from "hp_logger/hono";

const logger = createLogger();
const app = new Hono();

app.use(honoMiddleware(logger));
app.get("/", (c) => c.text("ok"));
```

### Fastify

```ts
import Fastify from "fastify";
import { createLogger } from "hp_logger";
import { fastifyPlugin } from "hp_logger/fastify";

const logger = createLogger();
const fastify = Fastify();

await fastify.register(async (instance) => {
  await fastifyPlugin(instance, logger);
});
```

## Metrics (Prometheus)

Zero-dependency metrics in Prometheus format: `Counter`, `Gauge`, `Histogram`, `Registry`. Useful for a `/metrics` endpoint without external client libraries.

```ts
import { Counter, Gauge, Histogram, Registry } from "hp_logger";

const registry = new Registry();

const requests = new Counter({
  help: "Total number of HTTP requests",
  labelNames: ["method", "status"],
  name: "http_requests_total",
  registers: [registry],
});

const duration = new Histogram({
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  help: "HTTP request duration in milliseconds",
  labelNames: ["method"],
  name: "http_request_duration_ms",
  registers: [registry],
});

const clients = new Gauge({
  help: "Connected WebSocket clients",
  name: "ws_clients",
  registers: [registry],
});

requests.inc({ method: "GET", status: "200" });
duration.observe({ method: "GET" }, 12);
clients.set(5);

// Prometheus text format: # HELP, # TYPE, samples, histograms with _bucket/_sum/_count
const text = registry.metrics();
```

- `Counter` - monotonically increasing counter, `inc(labels?, value = 1)`.
- `Gauge` - value that can go up and down, `set`/`inc`/`dec`.
- `Histogram` - distribution of observations into buckets, `observe(labels, value)`.
- `Registry` - collects metrics and produces text; metric names must be unique and match `[a-zA-Z_:][a-zA-Z0-9_:]*`.

## Global error handlers

```ts
import { createLogger, installGlobalErrorHandlers } from "hp_logger";

const logger = createLogger();
installGlobalErrorHandlers(logger);
```

`unhandledRejection` and `uncaughtException` are logged through the logger.

## Package commands

```bash
bun test            # tests
bun run typecheck   # type checking
bun run lint        # linting
bun run bench       # micro benchmarks (ops/s per mode)
bun run build       # build dist for publishing
```

## License

MIT
