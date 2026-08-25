# hp_logger



[![npm](https://badgen.net/npm/v/hp_logger?icon=npm)](https://www.npmjs.com/package/hp_logger)
[![downloads](https://badgen.net/npm/dm/hp_logger?icon=npm)](https://www.npmjs.com/package/hp_logger)
[![GitHub](https://badgen.net/github/stars/hullperse/hp_logger?icon=github)](https://github.com/hullperse/hp_logger)

![Dependencies](https://badgen.net/badge/dependencies/0/00c853)
![Performance](https://badgen.net/badge/performance/NYOOM/00c853)
![Console](https://badgen.net/badge/console.log/RETIRED/7c4dff)
![Powered](https://badgen.net/badge/powered%20by/rats/6b4f3a)
[![Production](https://badgen.net/badge/production/rat%20approved/6b4f3a)](https://github.com/hullperse/hp_logger)

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
- **Mixin hook** - merge request ids or tenant ids under every entry; explicit data wins, output still passes redaction.
- **Redaction** - passwords, tokens and bearer strings are masked before any transport sees them; `redactPaths` targets exact dot paths like `user.password`.
- **Output modes** - tagged pretty output on TTY, JSON lines in pipes and files, template-based custom lines, custom formatters, registered custom tokens (`registerToken`).
- **File output** - single file, daily rotation, or size-based rotation with retention and optional gzip; optional per-level files (`app.error.log`); optional fsync on close.
- **Database output** - ready-made SQLite adapter plus a generic adapter interface; self-healing rebuilds a dead adapter from a factory and drains the backlog.
- **Batching** - async batched writes with a bounded queue, delivery stats and severity-triggered flushes.
- **Flood control** - collapse repeats, once/throttle keys, adaptive sampling during error storms.
- **Spans and traces** - manual and callback spans with AsyncLocalStorage propagation, a trace tree renderer, and `spanPath` on entries written inside a scope.
- **Call-site links** - opt-in `callSite` attaches a clickable `path:line:col` to error and fatal entries.
- **Terminal attention** - opt-in `attention` rings the bell on the first fatal or storm start, shows the storm in the terminal title, and mirrors open tasks as taskbar progress (OSC 9;4). TTY-only, off by default.
- **Black box** - a ring of recent entries dumped to a JSONL file and flushed on crash, so buffered logs survive process death.
- **Watch** - poll endpoints or custom probes and log availability edges, with optional exponential backoff and jitter on failures.
- **Worker offload** - `hp_logger/worker` moves serialization and IO to a background thread that restarts itself after a crash.
- **Metrics** - zero-dependency Counter, Gauge, Histogram and Registry in Prometheus text format, with snapshot helpers.
- **Box drawing** - optional ASCII frames around error chains, fatal bodies and storm notices in pretty output.
- **Log server** - `hp_logger/http` serves recent entries over cursor polling and a live WebSocket stream (resume by sequence id, capability handshake), plus `/stats` and `/spans` routes and optional token-gated remote level control.
- **Integrations** - Elysia, Bun.serve, Node http, Hono and Fastify middlewares with correlation ids.
- **Env-driven tuning** - `LOG_LEVEL` for the root level, `LOG_MODULES="auth:debug,http:warn"` per module.
- **Schema versioning** - opt-in `v` field on every entry plus a versioned sqlite column, so stored logs survive format changes.

Full guides, the complete settings reference and integration recipes live on the documentation site linked in this repository's GitHub description.

## Security

- Zero runtime dependencies: `npm install hp_logger` installs exactly one package.
- `devDependencies` (framework SDKs for integration tests, TypeScript, linters) and optional `peerDependencies` are never installed by consumers and never enter the published tarball.
- The published tarball contains only `dist/`, `README.md` and `LICENSE` - verifiable with `npm pack --dry-run`.
- Redaction runs before every transport; the full security contract lives in `.docs/SECURITY.md` in this repository.

## AI usage disclosure

AI tools were used in building this project for general code structuring, JSDoc comments and security review passes. Architecture, API design and every product decision are made by a human. The documentation and agent-workflow system used throughout development is open source: [hp_docs](https://github.com/hullperse/hp_docs).

## License

MIT
