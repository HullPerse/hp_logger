---
name: hp-docs
version: 1.4.2
description: Universal .docs template system for AI agents (English canonical, translated at init to the chosen project language). Handles first-run project analysis and initialization questions (documentation language, package manager, lint/format preset, design preset, product spec), stack comparison, template setup, deep code/dependency/architecture analysis with rule compliance auditing, and new project initialization.
---

# HP-Docs Skill

Universal `.docs/` template system for AI agents. Generates comprehensive project documentation, decision journals, review workflows, and performs deep analysis including rule compliance auditing.

## When to Use

- **First run**: Agent encounters a project without `.docs/` or with incomplete `.docs/`
- **New project**: User wants to initialize `.docs/` for a fresh project
- **Deep analysis**: User wants comprehensive code/dependency/architecture review with refactoring suggestions
- **Repeated access**: Agent needs to read `.docs/` rules before working

## Canonical Stack Reference

The reference stack for comparison (risovach-style TypeScript projects):

**Backend**: Bun + Elysia + Drizzle ORM + SQLite (bun:sqlite)
**Frontend**: React 19 + Vite + TanStack Router/Query + Zustand
**Tooling**: oxlint/oxfmt or eslint/prettier, Vitest, TypeScript strict
**Package manager**: Bun

This is NOT a requirement. It is a baseline for detecting mismatches and suggesting alternatives. The agent must adapt rules to the actual stack.

## First-Run Flow

When `.docs/` is missing or incomplete:

### 1. Scan Project

Read these files and directories:
- `package.json` (or `Cargo.toml`, `pyproject.toml`, `go.mod`)
- `tsconfig.json` (or equivalent)
- `bun.lock` / `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`
- Directory structure (top 2-3 levels)
- `README.md`
- `.gitignore`
- Existing config files (eslint, prettier, vite, webpack, etc.)
- `backend/` and `frontend/` if monorepo

### 2. Determine Stack

Identify:
- **Language**: TypeScript, Rust, Python, Go, etc.
- **Runtime**: Bun, Node.js, Deno
- **Backend framework**: Elysia, Express, Fastify, Axum, FastAPI, etc.
- **ORM/DB**: Drizzle + SQLite, Prisma + Postgres, SQLx, SQLAlchemy, etc.
- **Frontend framework**: React, Vue, Svelte, Solid
- **Styling**: Tailwind, CSS modules, styled-components, etc.
- **State management**: Zustand, Redux, Jotai, Pinia, etc.
- **Data fetching**: TanStack Query, SWR, useEffect, etc.
- **Routing**: TanStack Router, React Router, file-based, etc.
- **Testing**: Vitest, Jest, pytest, cargo test, etc.
- **Linting**: oxlint, eslint, biome, clippy, ruff, etc.
- **Package manager**: Bun, npm, yarn, pnpm, cargo, pip

### 2.5 Initialization Questions

Ask the user as one batch before filling templates. Every answer is logged in `.docs/DECISIONS.md` and reflected in the `.docs/` files. Mark one option `(recommended)` per question.

**Q1: Documentation language**

Canonical templates are English. Which language should generated docs and agent communication use?

- English `(recommended)` - zero translation drift; canonical text used as-is
- Russian or another language - the agent translates every generated `.docs/` file into that language during initialization; communication follows it; deslop word-tag lists stay bilingual

**Q2: Package manager**

- Bun `(recommended)` - fastest install/run/test among JS managers, built-in test and TS support
- pnpm - strict node_modules, disk efficiency, mature workspace support
- npm - zero extra tooling, maximum compatibility
- yarn - only if the project already uses it

The answer defines every command in the docs (`bun run lint`, `pnpm lint`, ...).

**Q3: Lint and format preset**

- Ultracite + oxlint/oxfmt `(recommended)` - AI-ready zero-config preset, type-aware rules via oxlint-tsgolint, OXC speed. Configs: `oxlint.config.ts` extends `ultracite/oxlint/core` (+ `ultracite/oxlint/react`, `ultracite/oxlint/tanstack` for frontend), `oxfmt.config.ts` spreads `ultracite/oxfmt`. Scripts: `check` = `ultracite check`, `fix` = `ultracite fix`.
- Ultracite + Biome - same preset on the Biome engine
- Plain oxlint + oxfmt - minimal ruleset without presets
- ESLint + Prettier - largest plugin ecosystem, slower and more verbose config
- None - typecheck only (small utilities)

**Q4: Design preset** (UI projects only)

- Scandinavian `(recommended)` - calm black-and-white base, alpha ink ladder, Inter/system sans, 8px rhythm
- Neo-brutalism - radius 0, 2px borders, hard shadows, monospace font
- Zed dark - dark theme for native desktop tools
- Custom - user describes style or reference; rewrite DESIGN.md section for it

**Q5: Product spec** (optional)

- Yes - create `product-spec.md` in the project root: single source of truth for the feature set, referenced from AGENTS.md; for projects with large product scope
- No (default) - features live in `.docs/features/*.md` and DECISIONS.md

**Q6: Backend logging** (backend projects only)

- hp_logger - logging package by HullPerse for Bun/Elysia backends: transports, redaction, Prometheus metrics (github.com/HullPerse/hp_logger)
- Ecosystem package - pino, winston, or another; pick during deep analysis with package comparison
- None yet / not a backend project - skip; revisit when the backend appears

Recommendation status intentionally neutral until the canonical stack recommendation is revised.

### 3. Stack Comparison

Compare detected stack against canonical stack. For each deviation, analyze:

- Is the alternative **better** for this use case? (mark as `(recommended)` if so)
- Is it **equivalent**? (note but no action)
- Is it **worse**? (suggest alternative with justification)

Present findings as a table:

```
| Component | Detected | Canonical | Verdict | Notes |
|-----------|----------|-----------|---------|-------|
| Runtime | Node.js | Bun | equivalent | Node works fine |
| ORM | Prisma | Drizzle | suggestion | Drizzle is lighter, see alternatives |
| State | Redux | Zustand | suggestion | Zustand is simpler for this scale |
```

Only suggest changes where there is a real, measurable benefit. Do not suggest changes just because the canonical stack is different.

### 4. File Naming Analysis

Analyze existing file naming conventions in the project:

**For existing projects:**
1. Scan file names across `src/`, `lib/`, `components/`, `hooks/`, `api/`, `types/`, `config/`
2. Detect patterns:
   - **Casing**: camelCase, PascalCase, kebab-case, snake_case, dot.notation
   - **Suffixes**: `.component.tsx`, `.service.ts`, `.hook.ts`, `.utils.ts`, `.config.ts`, or none
   - **Prefixes**: `use*` for hooks, `I*` for interfaces, or none
   - **Index files**: `index.ts` barrel exports or direct imports
3. Check consistency -- are there conflicting patterns?
4. Adopt the dominant pattern as the project convention

**For new projects:**
1. Detect language and ecosystem
2. Present 4 options to user:

| # | Option | Description |
|---|--------|-------------|
| 1 | **Industry standard** | Standard convention for the language/ecosystem (see table below) |
| 2 | **HullPerse** | `<domain>.<suffix>.<ext>` camelCase with dot separator (see table below) |
| 3 | **Custom** | User describes their own convention |
| 4 | **Decide yourself** | Agent picks based on project type, team size, and ecosystem norms |

3. Mark one option `(recommended)` based on project context:
   - Solo/small project, TypeScript: HullPerse `(recommended)`
   - Large team, ecosystem interop needed: Industry standard `(recommended)`
   - Non-TypeScript: Industry standard `(recommended)`
4. Ask user which to use

**Option 1: Industry standard**

| Language | Convention | Example |
|----------|------------|---------|
| TypeScript/React | PascalCase components, camelCase utils | `Button.tsx`, `useAuth.ts`, `formatDate.ts` |
| Vue | PascalCase SFCs, camelCase composables | `Button.vue`, `useAuth.ts` |
| Rust | snake_case files | `my_module.rs`, `my_struct.rs` |
| Python | snake_case files | `my_module.py`, `my_class.py` |
| Go | snake_case files | `my_package.go` |

**Option 2: HullPerse** (risovach-style)

Pattern: `<domain>.<suffix>.<ext>` (camelCase basename, dot separator)

| Category | Suffix | Example |
|----------|--------|---------|
| UI components | `.component.tsx` | `button.component.tsx` |
| Canvas/Specialized | `.canvas.tsx` | `editor.canvas.tsx` |
| Icons | `.icon.tsx` | `github.icon.tsx` |
| Variants | `.variants.ts` | `button.variants.ts` |
| Routes | `.route.tsx` | `auth.route.tsx` |
| Route pages | `.auth.tsx`, `.menu.tsx`, etc. | `login.auth.tsx` |
| Hooks | `.hook.ts` | `dots.hook.ts` |
| Utils | `.utils.ts` | `color.utils.ts` |
| Contracts | `.contract.ts` | `replay.contract.ts` |
| Configs | `.config.ts` | `api.config.ts` |
| API clients | `.api.ts` | `user.api.ts` |
| Types | `.d.ts` | `auth.d.ts` |
| Tests | `.test.ts` | `canvas.test.ts` |
| Backend services | `.service.ts` | `user.service.ts` |
| Backend plugins | `.plugin.ts` | `auth.plugin.ts` |
| Backend DB | `.db.ts` | `schema.db.ts` |
| Backend entry | `.server.ts` | `app.server.ts` |

**Option 3: Custom**

User describes their convention. Agent documents it in `.docs/DEVELOPMENT.md` and enforces it.

**Option 4: Decide yourself**

Agent logic:
- TypeScript + solo/small team + component-heavy -> HullPerse
- TypeScript + large team + library/plugin ecosystem -> Industry standard
- Non-TypeScript -> Industry standard for that language
- Unclear -> ask user, don't guess

Present findings:

```
File Naming Convention:
  Detected: camelCase files, .component.tsx suffix, use* prefix for hooks
  Consistent: YES (98% compliance)
  Convention adopted: [chosen pattern]
  Exceptions: [list inconsistencies if any]
```

If inconsistencies exist, list them and ask user whether to fix now or defer.

### 5. Generate .docs/ Files

Generate ALL of the following files with full content adapted to the detected stack. Do NOT use placeholders like `{{...}}` -- fill everything with real data from the project. Canonical copies of every template live in `templates/` next to this SKILL.md; copy them into the project rather than writing from memory.

### 5.5 Skills Distribution

This skill ships inside a repository as part of the docs package:

- Source of truth: `<repo>/skills/<skill-name>/SKILL.md` (repo root `skills/` - this layout is discoverable by `npx skills add <owner>/<repo>`)
- During initialization, copy every skill from `skills/` into the target project's `.agents/skills/` so coding agents auto-discover them
- Keep `.agents/skills/` copies in sync when `skills/` changes; edit only the canonical copy under `skills/`
- Use the sync script: `scripts/sync-templates.ps1` (Windows) or `scripts/sync-templates.sh` (bash) rebuilds templates and mirrors from live files

Bundled skills:

- `hp-docs` - this skill
- `deslop` - consolidated prose de-slopping catalog merged from ten upstream anti-slop skills (banned word lists EN/RU, structural tells, punctuation limits, voice preservation, draft -> audit -> final loop)
- `scandinavian-design` - deep-dive visual system used by the default DESIGN.md preset; invoke for UI redesign work
- `docs-refactor` - bring an existing codebase to compliance with its own `.docs/` rules (audit, disposition, fixes)
- `docs-onboard` - connect a fresh agent chat to a project that already has AGENTS.md and `.docs/`; reads everything and returns the session contract summary
- `docs-init` - install the package into a clean project (runner question, CLI install with git-clone fallback, verification) and hand off to this first-run flow; triggers on "install hp_docs" or on skills present without root AGENTS.md

### 6. Docs Health Check

After generating all files, verify completeness. For EACH file, check that ALL required sections from "Template Files" below are present. Report missing sections:

```
Docs Health Check:  (top-level ## sections)
  AGENT_PROMPT.md    [12/12 sections] OK   (# 1..11 + Available tools)
  DEVELOPMENT.md     [13/13 sections] OK   (incl. Typing by language)
  DESIGN.md          [ 7/7 sections]  OK   (# 0 presets + # 1..6; or deleted for non-UI)
  CHECKLIST.md       [ 5/5 sections]  OK
  REVIEWER.md        [ 8/8 sections]  OK   (issue-file template headings inside the code fence do not count)
  DECISIONS.md       [ 2/2 sections]  OK
```

If sections are missing, generate them before proceeding. Do not skip health check.

### 7. Verify

Run these commands to confirm they work:
- `bun run dev` (or equivalent)
- `bun run typecheck` (or equivalent)
- `bun run lint` (or equivalent)
- `bun run test` (or equivalent)

Report which commands work, which fail, and why.

### 8. Ask User

After generating `.docs/`, health check, stack comparison, and file naming analysis:

```
Project detected and .docs/ filled.

Stack: [detected stack]
File naming: [detected convention or chosen convention for new project]

Deviations from the canonical stack:
[stack comparison table, if any]

Naming violations:
[list inconsistencies if any, or "none"]

Choose:
1. Deep analysis of the existing project -- detailed review of code,
   dependencies, architecture + rule compliance check against .docs/
   with refactoring proposals.
2. Skip analysis -- proceed to regular work.
```

## Template Files (Full Content)

Each file must be generated with COMPLETE content, adapted to the project's actual stack. Below are the required sections for each file. The agent must write full prose, not abbreviated bullet points.

### AGENTS.md (root)

Entry point for agents. Must contain:
- Project name and one-line description
- Quick start commands
- Mandatory reading list pointing to `.docs/` files
- Key rules summary (audit before code, anti-slop, disposition gate, critical mode)
- Available MCP tools if any

### .docs/AGENT_PROMPT.md

The main session contract. Must contain ALL of these sections:

1. **Project context**: backend stack, frontend stack, DB, directory layout
2. **Mandatory reading list**: ordered list of files to read before work
3. **DECISIONS.md gate**: must read before audit, must write after decisions
4. **Disposition gate**: two separate questions before each new feature (implementation disposition + documentation destination)
5. **`(recommended)` rules**: when to use, single-select vs multi-select, when NOT to use
6. **Mandatory first stage: audit**: what to check, classification (Blocker/Risk/Gap/Optimization/Clear), when to stop
7. **Critical mode**: don't agree with bad ideas, direct verdict format, allowed sharp language
8. **Questions and decisions**: hierarchy of truth sources, when to ask, question lifecycle (10 steps), grill mode (one question at a time, recommended answer per question, depth-first decision tree, codebase before asking)
9. **Planning and implementation**: scope, plan, affected files, test strategy, minimal changes, no speculative abstractions, existing code reuse
10. **Minimalism ladder (ponytail, mode full)**: 7 rungs (skip YAGNI -> reuse project code -> stdlib -> native platform -> installed dependency -> one line -> minimal code), root-cause bug fixes via caller grep, no unrequested abstractions, `ponytail:` comments for deliberate ceilings, laziness forbidden at trust boundaries/error handling/security/a11y/explicit requests
11. **Data flow rules (stack-adaptive)**: if a server query library is used - TanStack Query rules (one query per file preferred, `data` naming, explicit `isLoading`/`isError`, separate `isFetching`); otherwise project data-flow rules fixed at init (background threads + UI event subscription for desktop, per hpClean pattern); equivalent rules formulated per stack and agreed with the user
12. **Type rules**: language variants in DEVELOPMENT.md "Typing by language" - TS (no `any`, `unknown` only in boundary narrowed via Zod/type guard), Rust (Option/Result boundaries, unsafe only in isolated FFI), Python (strict typing), Go (error values)
13. **Directory boundaries**: where types, helpers, configs, hooks, API clients go
14. **File naming**: project convention detected during first-run (see file naming analysis); preserve established patterns, service suffixes, and casing
15. **Testing contract**: unit for domain rules, integration for persistence, fake services, typecheck + lint + test
16. **Documentation**: update DECISIONS.md, features, DESIGN.md, README
17. **Anti-slop rules**: ASCII punctuation only (no em/en dash), no template intros, no comment-parrots, no debug logs, no dead code, no placeholder data, no TODO instead of decision logging; deslop prose subsection (voice preservation, rule-of-three, parataxis, negative parallelism, significance inflation, vague attribution) pointing to the catalog in DEVELOPMENT.md
18. **Response format**: Audit, Decisions needed, Scope+Plan, Progress, Verification, Final state
19. **Available tools**: mandatory MCP check at session start - list available servers, use documentation tools (context7) for any library/API question before answering from memory, apply task-appropriate tools instead of workarounds

### .docs/DEVELOPMENT.md

Permanent project contract. Must contain ALL of these sections:

1. **Source of truth hierarchy**: explicit user decision > this file > DECISIONS.md > design docs > existing code
2. **Project description**: backend, frontend, DB schema location, docs location
3. **Fixed decisions**: concrete technical choices already made (migrations, roles, rejected approaches)
4. **Communication protocol**: 15-item list of what agent must/mustn't do
5. **Critical mode**: rules for disagreeing with user
6. **Disposition and destination**: full rules for feature disposition flow
7. **Feature file format**: style rules (plain text, Idea/Comment/Pros/Cons, no decorative tables)
8. **Decision journal rules**: mandatory logging, conflict resolution
9. **Anti-slop rules**: text/punctuation, code/architecture, UI/UX subsections; plus the deslop prose catalog (EN and RU word tags, structural patterns, punctuation limits, accuracy rules, voice preservation, self-check)
10. **Minimalism**: ponytail ladder summary and pointer to AGENT_PROMPT.md section 6
11. **File naming convention**: detected or chosen pattern with examples (casing, suffixes, prefix rules, exceptions)
12. **Documentation index**: what each .docs/ file contains

### .docs/DESIGN.md

Design system documentation with three built-in presets. Must contain ALL of these sections:

0. **Preset selection**: table of presets and the rule that the preset is chosen at initialization and logged in DECISIONS.md; user-defined style rewrites section 1 only
1. **Preset "Scandinavian" (default)**: alpha ink ladder (100%/64%/44% black over white, no gray casts), typography (Inter Variable/system sans, weight 500-600 headings, no all-caps), 8px rhythm, chapters-not-card-stacks, left alignment, one icon family, dark theme alpha recalculation rules, contrast validation
2. **Preset "Neo-brutalism"**: radius 0, 2px borders, hard shadows, monospace font, `:root` token set, component list
3. **Preset "Zed dark"**: dark desktop/GPUI theme tokens, compact sizes, no decorative gradients
4. **Components (common requirements)**: variants, sizes, props, states for every component
5. **A11y and required states**: focus indicators >= 2px, sr-only labels, keyboard navigation, color never the only signal
6. **Rules**: no duplicate components, no hardcoded values, preset changes require a decision

At initialization keep only the chosen preset section, remove or mark the others as unused. For non-UI projects keep sections 0 and 5 only, or delete the file.

### .docs/ROADMAP.md

Optional feature roadmap template: phases, ID-based entries, statuses done/now/deferred/rejected, return conditions for deferred/rejected items. Created when there are more than ~5 dispositioned features.

### product-spec.md (project root, optional)

Single source of truth for the feature set of projects with large product scope (hpClean pattern). Referenced from AGENTS.md; implementation details stay in `.docs/features/*.md`. Contains: role of the file, product description placeholder, numbered features, explicit "not building" list with reasons.

### .docs/answers/README.md

Optional folder instructions for long research answers (`answer_{N}.md`): context, analysis, dated facts, conclusion, `(recommended)` recommendation. Decisions derived from answers are duplicated in DECISIONS.md.

### .docs/CHECKLIST.md

Implementation checklist. Must contain ALL of these sections with specific items:

1. **Before coding**: read docs, check decisions, verify env, search existing code, check packages, compare alternatives, disposition gate, question formatting, scope check
2. **During coding**: single source of truth, directory boundaries, file naming, query rules, minimal changes, no dead code, states implementation, reuse existing components, design compliance, security, tests with features
3. **Verification**: lint, typecheck, test, exception documentation, diff review, anti-slop check, type check, unknown boundary check, file location check, dash check
4. **Feature files**: plain text style, idea/comment/pros/cons, no decorative formatting, code examples only when needed
5. **Documentation**: disposition+destination logging, DECISIONS.md updates, DESIGN.md updates, README updates, review suggestion

### .docs/REVIEWER.md

Independent reviewer prompt. Must contain ALL of these sections:

1. **Reviewer roles**: list of hats (Senior Engineer, Backend, Frontend, Performance, UX, A11y, Security, Test, Code Reviewer)
2. **Mandatory behavior**: 13 rules (no code changes, no .docs/ changes except reviews/, no checkboxes, no claiming tests ran without output, etc.)
3. **Source of truth**: ordered reading list
4. **Review scope selection**: ask user what to review
5. **Review workflow**: 6 steps (record, audit claims, inspect implementation, run checks, performance analysis, code cleanliness)
6. **Finding classification**: severity levels (Blocker/Critical/High/Medium/Low/Gap/Optimization/Cleanup), categories (15 categories)
7. **Remediation policy**: reviewer doesn't fix, provides plan with containment, minimal fix, affected files, tests, alternatives
8. **Issue file rules**: create only when findings exist, single file per run, structure template
9. **Chat response format**: scope, audit summary, verification, findings, performance, decisions needed, conclusion

### .docs/DECISIONS.md

Decision journal. Must contain:
- Extended format template:
  ```
  ### YYYY-MM-DD: Short header
  - Decision: what was decided
  - Context: why this decision was needed
  - Consequence: what changes as a result
  - Source: link to session/task
  ```
- Initial empty state with header
- Conflict rule: when a new decision conflicts with an existing one, stop and ask the user

### .docs/agents-audit.prompt.md

Audit prompt for checking rule freshness. Must contain:
- Audit checklist (all docs consistent, commands correct, structure matches, stack accurate)
- Process (read all .docs/, verify against code, report discrepancies)

### .docs/features/README.md

Feature file instructions. Must contain:
- Structure (one file per feature)
- Feature file template (Status, Description, Requirements, Implementation Notes, Disposition)
- Style rules (plain text, Idea/Comment/Pros/Cons format)

### .docs/reviews/README.md

Review issues folder. Must contain:
- Structure (one file per review issue)
- Review file template (Status, Description, Findings, Recommendation)

## Deep Analysis

When user selects deep analysis, perform ALL of these checks:

### 1. Code Analysis

- Architecture: responsibility mixing, logic duplication, speculative abstractions
- Typing: `any`, hidden `unknown`, weak types
- Error handling: boundaries, typed errors, graceful degradation
- States: loading, error, empty, disabled, dirty, stale, recovery
- Tests: domain rule coverage, integration tests
- Security: secrets in code, XSS, injections
- Performance: memory leaks, unoptimized renders, missing memoization

### 2. Dependency Analysis

- Outdated packages with modern alternatives
- Duplicate functionality (multiple HTTP clients, etc.)
- Security vulnerabilities
- Heavy packages that can be replaced
- Unused dependencies

For each package: current status, alternative (if exists), comparison (size, speed, support, license), `(recommended)` only with real justification.

### 3. Tooling Analysis

- Linters and formatters: config freshness, conflicts
- TypeScript: strictness, unnecessary `@ts-ignore`
- Build system: version, optimization
- Test framework: coverage, speed, config

### 4. Rule Compliance Analysis (Refactoring)

Check the codebase against the rules defined in `.docs/DEVELOPMENT.md` and `.docs/AGENT_PROMPT.md`. For each rule, verify compliance:

**File organization:**
- Are common types in `types/*.d.ts`?
- Are helpers in `lib/*.utils.ts`?
- Are configs in `config/*.config.ts`?
- Are hooks in `hooks/**/*.hook.ts` (or equivalent)?
- Are API clients in `api/**/*.api.ts` (or equivalent)?
- Do files follow the project's detected naming convention (casing, suffixes, prefixes)?

**Code quality:**
- No explicit `any` in written code
- `unknown` only in boundary code, narrowed before use
- No debug logs, dead code, placeholder data
- No comment-parrots (comments that restate code)
- No em/en dash (ASCII punctuation only)
- No TODO instead of decision logging

**Query/data patterns (if TanStack Query):**
- One `useQuery`/`useSuspenseQuery` per file (with justification for exceptions)
- `data` variable not renamed without reason
- `isLoading`/`isError` explicitly handled
- `isFetching` used separately for background refresh

**State management:**
- Single source of truth for each piece of state
- No duplicate state across stores
- Server state via Query, client state via Zustand/store

**UI/UX:**
- All interactive elements have focus indicators
- Loading, empty, error, disabled states implemented
- Design tokens used (no hardcoded colors/radii)
- No duplicate components when existing ones suffice

Present compliance as a table:

```
| Rule | Status | Violations | Files |
|------|--------|------------|-------|
| No `any` | PASS | 0 | -- |
| File naming | FAIL | 3 | foo-bar.tsx, baz-qux.tsx |
| One query per file | WARN | 1 | component.tsx (justified) |
```

### 5. Report Format

```
## Deep Analysis: [PROJECT_NAME]

### Structure
Architecture and code organization summary.

### Stack Comparison
| Component | Detected | Canonical | Verdict | Notes |
|-----------|----------|-----------|---------|-------|

### Findings

#### Code
| # | Type | File/Module | Issue | Recommendation |
|---|------|-------------|-------|----------------|

#### Dependencies
| # | Package | Version | Status | Alternative | Recommendation |
|---|---------|---------|--------|-------------|----------------|

#### Tooling
| # | Tool | Status | Issue | Recommendation |
|---|------|--------|-------|----------------|

#### Rule Compliance
| Rule | Status | Violations | Files |
|------|--------|------------|-------|

### Summary
- Project health: X/10
- Critical issues: N
- Rule violations: N
- Improvement recommendations: N
- Next step: specific action

### Disposition
For each suggestion:
- Implementation: [now / defer / reject]
- Documentation: [existing feature file / new / DECISIONS.md]
```

### 6. Log Decisions

Every improvement suggestion gets disposition from user:
- **now** -- implement immediately
- **defer** -- write to feature file with return conditions
- **reject** -- write to DECISIONS.md with reason

All decisions go to `.docs/DECISIONS.md` and feature files.

## New Project Initialization

If project doesn't exist (empty repo):

### 1. Ask User

```
No project detected. Choose:
1. Propose a stack and initialize the project
2. Fill .docs/ only -- the user defines the stack later
```

### 2. Determine Requirements

Ask about:
- Project purpose (web app, CLI, API, library, bot)
- Stack preferences (or trust agent's choice)
- Required platforms (desktop, mobile, web, server)
- References or examples

### 3. Propose Stack

Compare 2-3 options against canonical stack. For each:
- Language and runtime
- Backend framework
- Database/ORM
- Frontend framework
- State management
- Data fetching
- Testing
- Package manager

Mark `(recommended)` only with real justification (performance benchmarks, ecosystem maturity, team familiarity, project requirements).

### 4. Initialize

After stack selection:
1. Create directory structure matching `.docs/` conventions
2. Initialize dependencies
3. Configure TypeScript, linter, formatter, test framework
4. Add base scripts (dev, test, lint, typecheck, build)
5. Create `.gitignore`
6. Generate full `.docs/` templates with real data
7. Log all decisions to `.docs/DECISIONS.md`

### 5. Verify

1. Run `dev` -- confirm project starts
2. Run `test` -- confirm tests work (even if empty)
3. Run `lint`/`typecheck` -- confirm configs correct

## Repeated Access

When `.docs/` is already filled:

1. Read `AGENTS.md` for entry point
2. Read `.docs/AGENT_PROMPT.md` for session contract
3. Read `.docs/DECISIONS.md` before audit
4. Read relevant `.docs/features/*.md` for context
5. Follow all rules from `AGENT_PROMPT.md`

## Docs Migration

When the skill is updated and existing `.docs/` files need to align with the new template:

### 1. Detect Migration Need

Compare current `.docs/` files against the template sections listed in "Template Files". If any file has sections that:
- exist in the current file but not in the new template (potentially obsolete)
- are required by the new template but missing from the current file
- have changed format (e.g., DECISIONS.md format update)

### 2. Migration Report

Present a migration plan:

```
Docs Migration Plan:

AGENT_PROMPT.md:
  + ADD: Section 10 "Query rules" (new)
  ~ UPDATE: Section 6 "Audit" format (changed)
  - KEEP: All existing sections

DECISIONS.md:
  ~ UPDATE: Format from table to extended (Decision/Context/Consequence/Source)
  - KEEP: All existing decision entries (reformat in place)

DEVELOPMENT.md:
  + ADD: Multi-agent rules section (new)
  - KEEP: All existing decisions and rules
```

### 3. Execute Migration

- NEVER delete existing decisions or accepted rules
- ADD missing sections with content adapted to the project
- UPDATE format of existing sections, preserving their content
- Log the migration itself as a decision in DECISIONS.md

### 4. Verify

Re-run docs health check after migration to confirm all sections are present.

## Git Hooks Integration

During first-run, if the project uses git, suggest pre-commit hooks for automated anti-slop checking:

### Suggested Hooks

1. **ASCII punctuation check**: grep for em dash (`---`) and en dash (`--`) in staged `.md` and `.ts`/`.tsx` files
2. **No `any` check**: grep for `: any` and `as any` in staged `.ts`/`.tsx` files
3. **File naming check**: verify new component files use camelCase basenames

### Implementation

If user agrees, create a simple pre-commit script or husky hook:

```bash
#!/bin/bash
# .git/hooks/pre-commit or husky hook

# Check for em/en dash in staged files
if git diff --cached --name-only | xargs grep -Pn '[\x{2013}\x{2014}]' 2>/dev/null; then
  echo "ERROR: em/en dash found in staged files. Use ASCII punctuation only."
  exit 1
fi

# Check for explicit any in staged TS files
if git diff --cached --name-only -- '*.ts' '*.tsx' | xargs grep -Pn ':\s*any\b|as\s+any\b' 2>/dev/null; then
  echo "ERROR: explicit 'any' found in staged TypeScript files."
  exit 1
fi
```

Do NOT install hooks without user permission. Present as a suggestion with the exact script.

## Multi-Agent Rules

When multiple agents may work on the same project (parallel sessions, CI, different contributors):

### Decision Ownership

- DECISIONS.md is the single source of truth for all agents
- Each decision entry must include a Source field identifying the session/task
- When two agents propose conflicting decisions, the later agent must check DECISIONS.md first and flag the conflict
- Conflicts must be resolved by the user, not by agents overriding each other

### File Locking (Soft)

- Agents should not modify `.docs/` files that another agent is actively editing
- If a conflict is detected (file changed since last read), re-read the file and check if the change is relevant to the current task
- For code files: prefer small, focused changes that are less likely to conflict

### Session Identification

When writing to DECISIONS.md, include session context:
```
### 2026-08-20: Decision header
- Decision: ...
- Context: ...
- Consequence: ...
- Source: [task description or session id]
```

### Conflict Resolution Protocol

1. Agent reads DECISIONS.md before starting work
2. Agent checks for decisions that conflict with the planned approach
3. If conflict found: stop, report to user, wait for resolution
4. If no conflict: proceed, and log any new decisions before finishing
5. Never silently override an existing decision

## Strict Rules

All rules from the template system apply at all times:
- Audit before code
- Disposition gate for new features
- Anti-slop rules (ASCII punctuation, no comment-parrots, no debug logs)
- Critical mode (don't agree with bad ideas)
- Decision logging in DECISIONS.md
- `(recommended)` only with real justification
- Russian language for questions, ASCII punctuation only
- Rule compliance checking during deep analysis
