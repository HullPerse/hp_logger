# {{PROJECT_NAME}} reviews

Issue files created by independent review runs. One file per review run: `{scope}-{date}.md`. Created only when findings exist; an empty review creates nothing.

## Format

- Statuses: open, awaiting user decision, ready for implementation, resolved after re-review.
- Every finding carries a stable ID (`R-{date}-{number}`), severity, category, evidence with file paths, and remediation options.
- The reviewer never fixes code and never edits `.docs/` outside `reviews/`.
- A fix task may update issue status only after user approval; a re-review verifies the fix and appends the result.

Structure template lives in `.docs/REVIEWER.md`, section "Issue file rules".
