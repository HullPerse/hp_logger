# {{PROJECT_NAME}} Decisions

User decision journal. The agent must check this file before any question and append decisions after answers, so nothing gets asked twice.

## Entry format

```markdown
### YYYY-MM-DD: Short heading

- Decision: ...
- Context: ...
- Consequence: ...
- Source: session/task reference
```

## Conflict rule

When a new decision conflicts with an existing one, stop and ask the user. Never silently override or delete an existing entry.

## Entries

<!-- Appended by the agent as decisions are made -->
