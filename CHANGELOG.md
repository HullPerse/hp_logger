# Changelog

Notable changes to hp_logger. Versions follow semver; the package is 0.x, so
minor bumps may contain breaking renames.

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
