# {{PROJECT_NAME}} Implementation Checklist

Use for every non-trivial task. Copy only relevant items into the task plan.

## Before coding

- [ ] List available MCP servers and tools; for library questions use a documentation tool before answering from memory; apply task-relevant tools instead of workarounds.
- [ ] Read `.docs/AGENT_PROMPT.md`.
- [ ] Read `.docs/DEVELOPMENT.md`.
- [ ] Read and analyze `.docs/DECISIONS.md` before the audit: check accepted decisions, constraints, and conflicts.
- [ ] Read `.docs/DESIGN.md` if UI/UX is affected.
- [ ] Read module README and package.json.
- [ ] Search existing code and project conventions.
- [ ] Walk the ponytail ladder before writing your own solution: reuse neighboring code, then stdlib, then native platform, then installed dependencies; your own implementation is the last rung.
- [ ] Check `package.json`, lockfile, versions, and existing usage of suitable packages before writing your own implementation.
- [ ] Confirm the dependency is already used, or record why a new one is needed.
- [ ] If no ready-made package exists, compare several modern candidates by support, license, size, and performance, and explicitly name the recommended one.
- [ ] Check license and platform support for new dependencies.
- [ ] For every new feature ask implementation disposition: implement now, defer, or reject.
- [ ] For every new feature separately choose documentation destination: existing `.docs/features/*.md`, new `.docs/features/<slug>.md`, or only `.docs/DECISIONS.md`.
- [ ] Find remaining ambiguous decisions and ask the user.
- [ ] If the goal, boundaries, or expected outcome are unclear, restate your interpretation in one sentence and clarify before implementing instead of guessing.
- [ ] Check whether the proposal is unnecessary, harmful, premature, or overcomplicated; if so, give a direct verdict first, argue, and propose a better path.
- [ ] Group questions (no hard cap, no junk).
- [ ] Verify labels/descriptions: short plain language, one thought each, no stray foreign phrases, marketing filler, or pseudo-technical jargon.
- [ ] In multi-select, mark `(recommended)` only on individually justified options and explain that the marker does not mean selecting all of them.
- [ ] Include consequences, reversibility, security/privacy, performance, tests.
- [ ] Decide whether unanswered choices block implementation or a reversible safe default is acceptable.
- [ ] Draft a short implementation plan.
- [ ] Define tests for every new feature.

## During coding

- [ ] Single source of truth for state.
- [ ] New shared types, helpers, configs, hooks, and API clients live in their pinned directories with the accepted suffix.
- [ ] Component file basenames written in camelCase without hyphens, service suffix preserved.
- [ ] Minimal coherent change, no unrelated refactors.
- [ ] Bug fix made at the shared root, not on the one named path; callers verified via grep.
- [ ] Deliberate simplifications with a known ceiling marked with a `ponytail:` comment naming the upgrade path.
- [ ] Do not change existing behavior without a task.
- [ ] No speculative abstractions or dead extension points.
- [ ] Implement loading, empty, error, dirty, stale, recovery states.
- [ ] Before a new component search shared directories for an analog; never duplicate without reason.
- [ ] Compliance with `.docs/DESIGN.md` (when applicable).
- [ ] Data flow follows the project's fixed model (query library or background tasks); states come from it, not from duplicated manual state.
- [ ] No secrets in source, logs, or workspace files.
- [ ] Add tests together with the feature, not after declaring it done.

## Verification

- [ ] Run formatter/style: {{LINT_COMMAND}}.
- [ ] Run typecheck: {{TYPECHECK_COMMAND}}.
- [ ] Run relevant tests: {{TEST_COMMAND}}.
- [ ] Record an approved exception if a test layer cannot run.
- [ ] Review the diff for unrelated changes.
- [ ] Check for debug logs, placeholder data, dead code, stray comments.
- [ ] Verify typing per the project language rules ("Typing by language" in DEVELOPMENT.md): TS - no explicit `any`, `unknown` only at boundary with narrowing; Rust - Option/Result boundaries, unsafe isolated; Python - no silent Any on public boundaries.
- [ ] Verify data flow per the fixed model: query rules (one query per file, `data` naming, explicit isLoading/isError/isFetching) or background-task pattern.
- [ ] Check file locations: shared types in `types/*.d.ts`, helpers in `lib/*.utils.ts`, configs in `config/*.config.ts`, hooks in `hooks/**/*.hook.ts`, API clients in `api/**/*.api.ts`.
- [ ] Check component file names: camelCase without hyphens before the service suffix.
- [ ] If a local type/helper is needed outside those directories, agree on the exact path with the user before creating the file.
- [ ] Verify no em/en dashes were introduced.
- [ ] Run the deslop self-check on texts (catalog in `.docs/DEVELOPMENT.md`): word tags, rule-of-three, hedging, throat-clearing, participle tails, invented specifics; author's voice preserved.
- [ ] Mass text-file edits were performed with explicit UTF-8 encoding ([IO.File]::ReadAllText/WriteAllText), content spot-read after writing; PS 5.1 Get-Content/Set-Content without explicit encoding corrupts Cyrillic.
- [ ] Never substitute critique of an idea with insulting the user; every harsh verdict carries reasons, consequences, and an alternative.

## Feature files

- [ ] Affected `.docs/features/*.md` written as plain paragraphs and short lists.
- [ ] Idea separated from comment, pros, cons, and alternatives where needed.
- [ ] No tables, decorative formatting, or deep nesting without concrete benefit.
- [ ] Old/new code example added only when necessary, in fenced code blocks.
- [ ] No invented code for planning-only ideas.

## Documentation

- [ ] Record chosen implementation disposition and documentation destination in the feature file or `.docs/DECISIONS.md`.
- [ ] Append every significant decision, behavior change, or user-facing bug fix to `.docs/DECISIONS.md` before the final report; state explicitly when there were none.
- [ ] Update `.docs/DESIGN.md` if UX/visual rules changed.
- [ ] Update module README if commands/structure/conventions changed.
- [ ] Suggest independent review via `.docs/REVIEWER.md` for large changes.
- [ ] Report what was verified and what remains unverified.
