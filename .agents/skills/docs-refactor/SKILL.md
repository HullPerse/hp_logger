---
name: docs-refactor
version: 1.0.0
description: >
  Bring an existing codebase to compliance with its own .docs/ rules. Runs a rule
  compliance audit across file organization, naming, typing, data flow, state management,
  UI states, anti-slop and tests; classifies findings; gets a disposition per work
  package; executes approved fixes with tests and re-verification. Use when the user asks
  to "приведи проект к правилам", "рефакторни по доскам", "compliance pass",
  "проверь соответствие .docs", or after first-run deep analysis recommends a compliance
  refactor. Requires an initialized, placeholder-free .docs/ in the project.
---

# Docs Refactor

Brings existing code into compliance with the project's own rules from `.docs/`. This is not free-form refactoring: the only permitted source of requirements is the project's documentation.

## Preconditions

- `.docs/` exists and is filled (no `{{...}}` placeholders). If partially filled - run the `hp-docs` first-run flow first.
- Read before auditing: root `AGENTS.md`, `.docs/AGENT_PROMPT.md`, `.docs/DEVELOPMENT.md` (including "Typing by language" and the data-flow model), `.docs/DECISIONS.md`, `.docs/DESIGN.md` for UI parts, `.docs/CHECKLIST.md`.
- List available MCP tools and keep the list.
- Quick rule-freshness check: when a rule contradicts the actual code everywhere, that is a stale-rule finding, not a code finding. Flag it and ask the user; never silently follow a stale rule.

## Scope

If the user did not specify an area - ask: whole project, one module, or specific rule groups. Never guess from recently modified files.

## Compliance audit

Walk every rule area and collect violations:

| Area | What is checked |
| --- | --- |
| File organization | Naming (casing, suffixes), directory boundaries (`types/`, `lib/`, `config/`, `hooks/`, `api/` or project equivalents), local types/helpers outside pinned locations |
| Typing | The project language rules from DEVELOPMENT.md (TS any/unknown, Rust unsafe, Python Any, Go error values) |
| Data flow | The fixed model: query rules (one query per file, `data` without renaming, isLoading/isError/isFetching) or background tasks (UI never blocks, event subscriptions) |
| State | Single source of truth, no duplication between stores, server state in queries where applicable |
| UI/UX | Implemented loading/error/empty/disabled/stale states, focus indicators, design tokens instead of hardcoded values, duplicate components |
| Anti-slop / deslop | Comment-parrots, debug logs, dead code, placeholder data, em/en dashes in texts, dictionary word tags in documentation |
| Tests | Testing contract: domain rules covered, persistence integration-tested, tests shipped together with features |

Report format:

```markdown
| Rule | Status | Violations | Files |
|---|---|---|---|
| Component names camelCase+suffix | FAIL | 7 | foo-bar.tsx, ... |
| No explicit any | PASS | 0 | - |
| One query per file | WARN | 2 | lobby.api.ts (justified) |
```

Classify every finding group: Blocker (safety/data loss), Risk, Gap, Optimization, Cleanup.

## Disposition per work package

Group findings into packages (by area or by user scope) and request a disposition for each separately:

- **fix now** - executed in this task;
- **defer** - recorded as a feature file with return conditions;
- **reject** - recorded in DECISIONS.md with a reason; the rule then either stays with a "known exception" status or changes via a separate decision.

Never mix packages: one disposition covers one coherent set of changes.

## Execution

For each approved package:

1. A short plan: affected files, expected effect, test strategy.
2. Minimal coherent changes; nothing beyond the rule.
3. Tests alongside changes wherever logic is touched.
4. Package verification: lint, typecheck, relevant tests; rescan of the fixed rule.
5. Report each package separately, never as one mega-diff.

Constraints:

- No unrelated improvements along the way; anything extra becomes a separate finding with its own disposition.
- Mass file renames only through tools with explicit UTF-8 handling and content verification after writing.
- A Blocker stops everything until the user resolves it.
- Update `.docs/DECISIONS.md` with accepted decisions before the final report; suggest independent review via `.docs/REVIEWER.md` for large campaigns.

## Response format

Audit (compliance table) -> Packages and dispositions -> Per-package progress -> Verification (passed/failed/skipped/unavailable) -> Final state: what was brought to compliance, what was deferred, remaining risks.
