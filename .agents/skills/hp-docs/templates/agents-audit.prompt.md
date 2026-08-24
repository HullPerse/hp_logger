# {{PROJECT_NAME}} Agent Rules Audit Prompt

Run this prompt when you need to verify that agent rules are not stale and still match the current code.

## Task

Analyze every agent rules file in `.docs/` and the root `AGENTS.md`, and match them against the current state of the application.

Rules files:

- `AGENTS.md` (root)
- `.docs/AGENT_PROMPT.md`
- `.docs/DEVELOPMENT.md`
- `.docs/CHECKLIST.md`
- `.docs/DECISIONS.md`
- `.docs/DESIGN.md`
- `.docs/REVIEWER.md`

## What to check

1. **Commands and scripts**: do mentioned commands match real ones in `package.json` (or `Cargo.toml`, `pyproject.toml`, etc.).
2. **Project structure**: does the described structure match the real file tree.
3. **Accepted decisions**: did anything change in code contradicting `.docs/DECISIONS.md` entries.
4. **Technologies**: are there new dependencies/patterns not covered by the rules.
5. **Design system**: do tokens and components in `.docs/DESIGN.md` match real ones (when applicable).
6. **Coverage gaps**: are there scenarios in current work not covered by any rule.
7. **Staleness**: are there rules describing things no longer present in the code.

## Response format

### Contradictions
Every mismatch: rule path, what is written, what is in code, proposed fix.

### Gaps
What in the code is uncovered by rules, and which rule to add.

### Stale
Which rules no longer match the code, and what to do with them (delete/reformulate).

### Summary
Brief health summary of the rules and fix priorities. Mark `(recommended)` on real recommendations.

## Rules

- Never edit rules files based on audit results without user approval.
- This is an analytical prompt, not a code review: focus on rules-to-code correspondence, not on bugs in the code.
- Never ask questions that code or recorded decisions already answer.
