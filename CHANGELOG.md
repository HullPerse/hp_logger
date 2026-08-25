# Changelog

Notable changes to hp_logger. Versions follow semver; the package is 0.x, so
minor bumps may contain breaking renames.

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
