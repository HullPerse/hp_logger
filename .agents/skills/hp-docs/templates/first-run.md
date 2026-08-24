# First-Run: Full Documentation Initialization

This flow is executed by the agent on first encounter with `AGENTS.md` in a project where `.docs/` is missing or contains `{{...}}` placeholders. It consolidates everything: project analysis, initialization questions, skill installation, document generation, verification, and path selection.

## Important

All strict rules apply in full: audit before changes, disposition gate, anti-slop, direct critical mode, decision recording in DECISIONS.md.

---

## Step 0: Determine the project state

Three possible states:

1. **Project exists, `.docs/` missing or has placeholders** - execute this flow fully.
2. **Project does not exist** (empty repository) - steps 1-4 are replaced by new-project initialization (step 8).
3. **`.docs/` already filled and this is a fresh agent chat** - this flow is not needed; read root `AGENTS.md` and `.docs/` directly, or use the `docs-onboard` skill.

### "Project exists" criteria

- A `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, or equivalent exists.
- Sources exist (`src/` or equivalent) at least in a few files.

---

## Step 0.5: Mandatory MCP tool check

Before analysis, enumerate available MCP servers and tools in one action and keep the list:

- documentation tools (context7 and similar) - needed for current dependency docs in step 2;
- browser tools (Playwright and similar) - needed for UI projects;
- everything else - by task type.

If a needed tool does not exist, note it in the final report.

---

## Step 1: Scan the project

Read and analyze:

1. `package.json` (root and subdirectories) - stack, dependencies, scripts.
2. `Cargo.toml`, `pyproject.toml`, `go.mod`, or another dependency file for non-JS projects.
3. `tsconfig.json` / equivalents - typing strictness.
4. Lockfile: `bun.lock` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `Cargo.lock`.
5. Directory tree up to 3 levels.
6. `README.md`, `.gitignore`, main entry points.
7. Existing linter/formatter configs and CI.

---

## Step 2: Determine the stack

Determine and note for yourself:

- Language and runtime: TypeScript/Bun, Python, Rust, Go, etc.
- Frontend (if any): React, Vue, Svelte, etc.
- Backend (if any): Elysia, Express, Axum, FastAPI, etc.
- Database: SQLite, PostgreSQL, etc.
- Query library (TanStack Query, SWR) - determines the data-flow rules variant.
- Package manager from the lockfile.
- dev/test/lint/typecheck/build commands.

Use a documentation MCP tool instead of memory when checking library versions and capabilities.

---

## Step 2.5: Initialization questions

Ask as one batch before filling templates. Every answer is recorded in `.docs/DECISIONS.md` and lands in the respective `.docs/` file.

### Question 1: Documentation language

Canonical templates are English. Which language should the generated docs and agent communication use?

- English `(recommended)` - zero translation drift; canonical text used as-is.
- Russian or another language - the agent translates every generated `.docs/` file into that language during initialization; all future communication and doc updates follow it too.

### Question 2: Package manager

- Bun `(recommended)` - fastest install/run/test among JS managers, built-in test and TS support.
- pnpm - strict node_modules, disk efficiency, mature workspaces.
- npm - zero extra tooling, maximum compatibility.
- yarn - only if the project already uses it.
- cargo/pip/uv/go - for a non-JS stack this question resolves automatically.

The answer defines every command across all docs.

### Question 3: Lint and format

- Ultracite + oxlint/oxfmt `(recommended)` - AI-ready zero-config preset, type-aware rules via oxlint-tsgolint, OXC speed. Configs: `oxlint.config.ts` extends `ultracite/oxlint/core` (+ `ultracite/oxlint/react`, `ultracite/oxlint/tanstack` for frontend), `oxfmt.config.ts` = `ultracite/oxfmt`; scripts: `check` = `ultracite check`, `fix` = `ultracite fix`.
- Ultracite + Biome - same preset on the Biome engine.
- Plain oxlint + oxfmt - minimal ruleset without presets.
- ESLint + Prettier - largest plugin ecosystem, slower and more verbose config.
- cargo clippy/fmt, ruff, gofmt - for non-JS stacks.
- None - typecheck only (tiny utilities).

### Question 4: Design preset (UI projects only)

- Scandinavian `(recommended)` - calm black-and-white base, alpha ink ladder, Inter/system sans, 8px rhythm.
- Neo-brutalism - radius 0, 2px borders, hard shadows, monospace font.
- Zed dark - dark theme for native desktop tools.
- Custom - describe in words or by reference; the agent rewrites section 1 of DESIGN.md to match.

Non-UI projects: the section is removed along with the other presets.

### Question 5: Product spec (optional)

Is there a large product scope worth tracking in a separate file?

- Yes - `product-spec.md` is created in the project root: single source of truth for the feature set, referenced from AGENTS.md.
- No `(recommended)` default - features live in `.docs/features/*.md`.

### Question 6: Backend logging (backend projects only)

- hp_logger - logging package by HullPerse for Bun/Elysia backends: transports, redaction, Prometheus metrics (github.com/HullPerse/hp_logger).
- Ecosystem package - pino, winston, or another; pick during deep analysis with package comparison.
- None yet / not a backend project - skip; revisit when the backend appears.

The recommendation status of this question is intentionally neutral until the canonical stack recommendation is revised.

---

## Step 2.6: Installing skills into the project

If skills ship from this repository, copy them into the target project so agents auto-discover them:

```bash
cp -r skills/* <project>/.agents/skills/
```

Contents: `hp-docs` (this flow), `deslop` (prose cleanup), `scandinavian-design` (deep UI work), `docs-refactor` (bring code to its own docs rules), `docs-onboard` (connect a fresh agent chat). Install all of them: they are small and their triggers differ.

---

## Step 3: Filling placeholders

Replace all `{{...}}` with real project data:

| Placeholder | Data source |
|---|---|
| `{{PROJECT_NAME}}` | Name from package.json/name or README |
| `{{PROJECT_CONTEXT}}` | Stack + description from README/package.json |
| `{{PROJECT_OVERVIEW}}` | Description + directory tree |
| `{{FIXED_DECISIONS}}` | Answers to questions 1-6: manager, lint preset, language, design preset, data-flow model, backend logging + base rules from README |
| `{{DIRECTORY_STRUCTURE}}` | Directory tree analysis |
| `{{COMMANDS}}` | package.json scripts written through the chosen manager |
| `{{PRODUCT_DESCRIPTION}}` | If product-spec.md was created |

Per-file actions:

- **DEVELOPMENT.md**: fill "Typing by language" with the chosen variant (TS/Rust/Python/Go); fix the data-flow model (query library or background tasks) under "Fixed decisions".
- **DESIGN.md**: keep the chosen preset section, delete the other two (or mark "not used"). For a non-UI project keep sections 0 and 5 or delete the file.
- **AGENT_PROMPT.md**: verify the "Data flow rules" subsection reflects the chosen model.
- If Question 1 chose a non-English language: translate every generated `.docs/` file and AGENTS.md into that language now, keeping structure and section counts identical. Do not translate the deslop word-tag lists - they are bilingual reference content.

Never delete placeholders you could not fill - mark them `<!-- TODO: fill manually -->`.

---

## Step 3.5: Optional files

Create on demand, never upfront:

- `.docs/ROADMAP.md` - with 5+ dispositioned features forming phases.
- `.docs/answers/` - on user request for long research answers.
- `product-spec.md` - if chosen in question 5.

---

## Step 4: Verify commands

Run each and record the result: `{{LINT_COMMAND}}`, `{{TYPECHECK_COMMAND}}`, `{{TEST_COMMAND}}`. Mark passed / failed / unavailable separately with reasons. For a fresh project it suffices that commands exist and do not fail on an empty suite.

---

## Step 5: Docs Health Check

Verify every file contains all mandatory top-level sections:

```text
Docs Health Check:
  AGENT_PROMPT.md    [12/12 sections] OK   (# 1..11 + Available tools)
  DEVELOPMENT.md     [13/13 sections] OK
  DESIGN.md          [ 7/7 sections]  OK   (or deleted for non-UI)
  CHECKLIST.md       [ 5/5 sections]  OK
  REVIEWER.md        [ 8/8 sections]  OK   (issue-file template headings inside the code fence do not count)
  DECISIONS.md       [ 2/2 sections]  OK
```

Add missing sections before continuing. After template edits recount manually.

---

## Step 6: Path choice

Ask the user:

Project detected and `.docs/` filled. Stack: [...]. File naming: [...]. Deviations from canon: [...]. Choose:

1. **Deep analysis of the existing project** - detailed code, dependency, architecture review plus rule compliance check (step 7).
2. **Skip analysis** - proceed to regular work.

For an empty repository ask the step 8 question instead.

---

## Step 7: Deep analysis (if chosen)

All strict rules apply. Check four areas:

### 7.1 Code

Architecture (responsibility mixing, duplication, speculative abstractions), typing per language rules, error handling, states (loading/error/empty/disabled/dirty/stale/recovery), domain-rule tests, secrets, performance, anti-slop.

### 7.2 Dependencies

Outdated packages with modern alternatives, duplicate functionality, vulnerabilities, heavy packages, unused entries. For each: status, alternative with comparison (size, speed, support, license), `(recommended)` only with justification.

### 7.3 Tooling

Linter/formatter config freshness, typing strictness, build system, test framework.

### 7.4 Rule compliance

Walk the code against `.docs/`: file naming, directory boundaries, data-flow model, UI states, deslop of texts. Output a PASS/WARN/FAIL table per rule with violation counts and files.

### 7.5 Report and disposition

Format: structure, stack comparison, findings tables per area, project health X/10, critical issues, next step. Every suggestion receives disposition: now / defer (into a feature file with return conditions) / reject (recorded in DECISIONS.md with reason). For a large compliance campaign suggest the `docs-refactor` skill.

---

## Step 8: New project initialization (if no project exists)

Ask:

No project detected. Choose:

1. **Propose a stack and initialize the project** - the agent proposes an optimal stack and creates the base structure.
2. **Fill .docs/ only** - the user defines the stack later.

When initializing:

1. Clarify the project purpose (web/CLI/API/library/bot), platforms, references.
2. Propose 2-3 stack options in a table with criteria (language, framework, DB, speed, ecosystem), `(recommended)` only with justification.
3. Create directory structure, initialize dependencies, configure typing and the lint preset from question 3, add dev/test/lint/typecheck/build scripts, `.gitignore`.
4. Fill `.docs/` with real data, including the chosen design preset.
5. Verify: dev starts, test passes (even empty), lint/typecheck work.

---

## Step 9: Recording decisions

Add entries: template initialization, each answer to questions 1-6, chosen data-flow model, created optional files. Format lives in `.docs/DECISIONS.md`.

---

## Step 10: Report to the user

Show: detected stack and commands, which files were filled, what remains empty, health check and command verification results, recorded decisions. Suggest reviewing and extending `.docs/DECISIONS.md` and `.docs/DESIGN.md`.

---

## Flow constraints

- Never edit `AGENTS.md` during first-run, except adding the product-spec.md link when one was created.
- Never change template file structure - only placeholder contents and presets.
- Mass text-file edits require explicit UTF-8 encoding and spot-reads after writing: PS 5.1 Get-Content/Set-Content without explicit encoding corrupts non-ASCII text.
