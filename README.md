# hp_logger

Structured logger for Bun and Node.js. One dependency-free package for leveled logging, secret redaction, file and database output, flood control, tracing spans, Prometheus-style metrics and web framework integrations.

Built for servers that need readable console output in development, strict JSON lines in production, and a guarantee that logged secrets never reach disk.

## Install

```bash
bun add hp_logger
# or
npm install hp_logger
```

## Quick start

```ts
import { createLogger } from "hp_logger";

const logger = createLogger({ settings: { level: "info", mode: "pretty" } });

logger.info("server started", { port: 3000 });
```

## What is inside

- **Levels** - trace to fatal, per-module loggers, runtime setting patches.
- **Redaction** - passwords, tokens and bearer strings are masked before any transport sees them.
- **Output modes** - tagged pretty output on TTY, JSON lines in pipes and files, custom formatters.
- **File output** - single file or daily rotation, buffered writes.
- **Database output** - ready-made SQLite adapter plus a generic adapter interface for any database.
- **Batching** - async batched writes with a bounded queue and delivery stats.
- **Flood control** - collapse repeats, once/throttle keys, adaptive sampling during error storms.
- **Spans and traces** - manual and callback spans with AsyncLocalStorage propagation and a trace tree renderer.
- **Watch** - poll endpoints or custom probes and log availability edges.
- **Metrics** - zero-dependency Counter, Gauge, Histogram and Registry in Prometheus text format.
- **Web viewer** - optional HTTP endpoint serving the last N entries from memory.
- **Integrations** - Elysia, Bun.serve, Node http, Hono and Fastify middlewares with correlation ids.

Full guides, the complete settings reference and integration recipes live on the documentation site linked in this repository's GitHub description.

## AI usage disclosure

AI tools were used in building this project for general code structuring, JSDoc comments and security review passes. Architecture, API design and every product decision are made by a human. The documentation and agent-workflow system used throughout development is open source: [github.com/hullperse/hp_docs](https://github.com/hullperse/hp_docs).

## License

MIT
