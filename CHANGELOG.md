# Changelog

Notable changes to hp_logger. Versions follow semver; 1.0.0 is stable.

## 1.1.0 - 2026-09-05

### Added

- `PassthroughTransport` decorator base for `adaptive`, `repeat` and `leveled` transports.

### Changed

- Internal dedup waves with no behavior change: `dispatchBatch` in leveled transport,
  shared `finishRequest`/`skipSet`/`onFinish` in server plugins, shared error-block and
  token helpers in formatting, `writeGated` table in core.
- Documented the `pause()` bound (10_000 entries, drop-newest, counted in `stats().paused`)
  and the Elysia manual `withContext` correlation scope in README and llms.txt.

### Fixed

- Test isolation: blackbox cleanup moved from a test case to `afterAll`; `bun test --randomize`
  passes (seeds 3245476426 and 7).

## 1.0.0 - 2026-08-30

### Added

- Stable release - API frozen for 1.x. No breaking changes from 0.12.0.
- are-the-types-wrong (attw) check for distribution types.

### Changed

- Playground i18n now respects language switch (no double language), server-only examples vertical with full-width code blocks.

## 0.12.0 - 2026-08-30

### Added

- `Logger.stats()` now reports `paused` queue and drop counters when `pause()` is used.
- `ResolverEntry.onTimeout` - separate from `onError` for timeout handling (defaults to `onError`).
- `src/writer/bufferedConsole.writer.ts` - extracted two-channel buffering for `ConsoleTransport` (out/err, 64-line cap, interval flush).
- `src/api/metrics.api.ts`, `span.api.ts`, `task.api.ts`, `watch.api.ts` - facade split of `Logger` god-class.

### Changed

- `BaseFileTransport.flush` now serializes concurrent flushes via promise lock.
- `LeveledTransport` recursion replaced with loop for large batches.
- `SizeBasedFileTransport` gzip now awaited during rotation.
- `dispatchBatch` avoids `Promise.all` for sync transports.
- `factory.writer` uses table `FILE_CTOR_BY_ROTATION`.
- `mergeEntryContext` and `sanitizeContext` avoid `Object.keys` allocations.
- `pipeline` merges `AsyncLocalStorage` for context and span path into single store.
- `entry` builders deduped via shared helpers while keeping compiled `entryPlan`.
- `settings` path validation now warns on absolute paths outside cwd and blocks traversal.

### Fixed

- `pause()` buffer now bounded at 10_000 entries (drop-newest) instead of unbounded.
- `globalTransports` dispatch now snapshots the array to avoid mutation during iteration.
- File and blackbox path handling hardened against directory traversal.

## 0.11.0 - 2026-08-26

### Added

- `settings.baseFields` - static top-level metadata stamped on every entry.
- `logger.pause()` / `resume()` - FIFO buffering of entries.
- `logger.rotate()` - manual trigger for size-based rotation.
- `settings.redactPii` and `settings.redactCensor` - PII detectors and custom censor token.
- Compiled `finalize` fast-path for `prettyTruncate`/`prettyWrap`.
- Memoized `escapeValue` for metrics label escaping.
- `TtlCache` and bounded `LruCache` for `once`/`throttle` and resolver TTL.


### Fixed

- Published type declarations resolve again. `tsc` does not copy hand-written
  `src/types/*.d.ts` into `dist/`, so every release since at least 0.8.3
  shipped declarations with dangling `../types/*` imports: consumers compiling
  with `skipLibCheck: false` failed with TS2307 storms and default setups
  silently lost typing that crossed those imports (runtime code unaffected).
  The build now copies the declarations into `dist/types/`, and a new
  `verify:dist` gate fails the build when any relative specifier inside an
  emitted declaration dangles; wired into the publish workflow.

## 0.10.0 - 2026-08-26

### Added

- `settings.bufferedConsole` (default off) - coalesce rendered console lines
  into one stdio write per flush window (unref timer, 64-line cap,
  `flush()`/`close()`, process-exit tail drain). About 3x faster end to end
  on real redirected output. Trades away the log/debug method split inside a
  chunk and the tail since the last flush on a hard kill; both documented.
- `Logger.stats()` gains an optional `caches` section: frozen snapshots from
  the brain primitives (`stats()`/`resetStats()` on LruCache, Memoize,
  RingBuffer, GroupCounter) plus logger-owned blackbox ring and profiler
  cache, keyed by name through the new module-level registry.

### Changed

- Top-level `error`/`reason` context values that are `Error` instances now
  serialize to name/message/stack/cause before the redaction branch. Without
  redaction JSON output carried `"error":{}` (non-enumerable fields); with
  redaction enabled the replacement behavior is unchanged (a non-enumerable
  brand keeps the serialized form visible to sinks while staying invisible
  to the redaction scan).
- Console transport dispatch no longer wraps synchronous writes in an async
  frame; argument normalization is allocation-free. Paired bench medians:
  plain +65% (~4.1M ops/s), json +47%, redaction-on +51%, child +30%.

## 0.9.1 - 2026-08-25

### Fixed

- Rebuilt the package from a clean `dist/` so stale resolver artifacts from
  an earlier local rename cannot enter the npm tarball.

## 0.9.0 - 2026-08-25

### Added

- `settings.resolvers` - per-key enrichment lookups with a bounded cache:
  `resolvers: { userId: { as: "username", resolve: async (id) => (await users.find(id))?.username } }`.
  When a context key has a resolver, the entry waits up to `timeoutMs`
  (default 50ms) for a cache miss and the resolved fields are merged next
  to the raw key (object results merge their own keys, scalars land under
  `as`). Results are cached per value for `ttlMs` (default 60s), concurrent
  lookups for the same value share one in-flight call, and a throwing or
  timed-out lookup falls back to the raw value (`onError: "mark"` records a
  `[RESOLVER ERROR]` marker instead). Works on static, async-local and
  call-site context; only loggers with resolvers configured take the async
  path, the synchronous fast path is untouched.
- `hp_logger/database` subpath export with `DatabaseTransport` and
  `createSqliteAdapter`; the database transport is no longer part of the
  root bundle (it loads lazily only when `settings.database` is used).

### Breaking

- `DatabaseTransport` and `createSqliteAdapter` moved from the root export
  to `hp_logger/database` (`import { DatabaseTransport } from "hp_logger/database"`).

## 0.8.3 - 2026-08-25

### Changed

- Republish under a new version: identical source to 0.8.2, built from a
  wiped `dist/` so no stale artifacts ship. No code changes; the release
  refreshes registry and CDN cache entries after the bundle-analysis
  investigation.

## 0.8.2 - 2026-08-25

### Changed

- Declared `sideEffects: false` in package metadata so bundlers can
  tree-shake unused exports with confidence (no import-time side effects
  exist; verified with an esbuild A/B bundle).

## 0.8.1 - 2026-08-25

### Added

- `settings.mixin(context, level)` - enrichment hook merged under every
  entry's context before serializers and redaction; explicit call-site data
  wins over mixin fields.
- `spanPath` - entries written inside a callback span or task carry the
  root-to-leaf chain of active span names as a top-level field.
- `settings.schemaVersion` - stamps `v: 1` onto every entry; the sqlite
  adapter takes a matching opt-in `version` column with schema validation.
- `callSite` - opt-in caller location ("path:line:col") on error and fatal
  entries, rendered as an OSC 8 terminal hyperlink in pretty output.
- `registerToken(name, render)` - user-defined template tokens; registered
  tokens win over context keys, built-ins stay reserved.
- Worker-thread transport restarts automatically after a crash with
  exponential backoff (1s base, 30s cap, jitter).
- `watch.backoff` - exponential delay with jitter between probes after
  failures, reset on success.
- `file.fsync` - fsync the file descriptor on close for strict durability.
- Metric snapshots (`settings.profile`, `logger.metricsBox()`) and optional
  ASCII box frames (`settings.box`) around error/fatal/storm blocks.

### Changed

- CI runs the suite on ubuntu, windows and macOS with lcov/junit artifacts;
  releases publish through npm OIDC trusted publishing with provenance.

### Security

- Capability budget unchanged: no new outbound channels; zero runtime
  dependencies maintained.
