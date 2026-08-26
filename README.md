# hp_logger



[![npm](https://badgen.net/npm/v/hp_logger?icon=npm)](https://www.npmjs.com/package/hp_logger)
[![downloads](https://badgen.net/npm/dm/hp_logger?icon=npm)](https://www.npmjs.com/package/hp_logger)
[![GitHub](https://badgen.net/github/stars/hullperse/hp_logger?icon=github)](https://github.com/hullperse/hp_logger)

![Dependencies](https://badgen.net/badge/dependencies/0/00c853)
![Performance](https://badgen.net/badge/performance/NYOOM/00c853)
![Console](https://badgen.net/badge/console.log/RETIRED/7c4dff)
![Powered](https://badgen.net/badge/powered%20by/rats/6b4f3a)
[![Production](https://badgen.net/badge/production/rat%20approved/6b4f3a)](https://github.com/hullperse/hp_logger)

Structured logger for Bun and Node.js. One dependency-free package for leveled logging, secret redaction, file output, flood control, tracing spans, Prometheus-style metrics and web framework integrations. The database transport and sqlite adapter live in the optional `hp_logger/database` subpath so the main import stays small.

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
- **Resolver enrichment** - look up values such as `userId` in a database or service and add fields such as `username` with a deadline, TTL cache and in-flight deduplication.

```ts
const logger = createLogger({
  settings: {
    resolvers: {
      userId: {
        as: "username",
        resolve: async (id) => (await users.findByPk(id))?.username,
      },
    },
  },
});
logger.info("user logged in", { userId: 42 });
// context: { userId: 42, username: "alice" }
```
- **Redaction** - passwords, tokens and bearer strings are masked before any transport sees them; `redactPaths` targets exact dot paths like `user.password`; opt-in `redactPii` detects emails and card numbers in free text; `redactCensor` replaces the default `[REDACTED]` token.
- **Output modes** - tagged pretty output on TTY, JSON lines in pipes and files, template-based custom lines, custom formatters, registered custom tokens (`registerToken`).
- **Base fields** - static metadata (pid, hostname, service) stamped onto every entry as top-level JSON fields via `settings.baseFields`.
- **Pause/resume** - buffer entries during pause, drain in FIFO order on resume.
- **File output** - single file, daily rotation, or size-based rotation with retention and optional gzip; optional per-level files (`app.error.log`); optional fsync on close; `logger.rotate()` triggers manual rotation on size-based writers.
- **Database output** - ready-made SQLite adapter plus a generic adapter interface; self-healing rebuilds a dead adapter from a factory and drains the backlog.
- **Batching** - async batched writes with a bounded queue, delivery stats and severity-triggered flushes.
- **Flood control** - collapse repeats, once/throttle keys, adaptive sampling during error storms.
- **Spans and traces** - manual and callback spans with AsyncLocalStorage propagation, a trace tree renderer, and `spanPath` on entries written inside a scope.
- **Call-site links** - opt-in `callSite` attaches a clickable `path:line:col` to error and fatal entries.
- **Black box** - a ring of recent entries dumped to a JSONL file and flushed on crash, so buffered logs survive process death.
- **Watch** - poll endpoints or custom probes and log availability edges, with optional exponential backoff and jitter on failures.
- **Worker offload** - `hp_logger/worker` moves serialization and IO to a background thread that restarts itself after a crash.
- **Metrics** - zero-dependency Counter, Gauge, Histogram and Registry in Prometheus text format, with snapshot helpers.
- **Box drawing** - optional ASCII frames around error chains, fatal bodies and storm notices in pretty output.
- **Web viewer** - optional HTTP endpoint serving the last N entries from memory.
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
