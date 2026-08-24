# {{PROJECT_NAME}} Roadmap

Feature roadmap dispositioned through the disposition gate. Created optionally when there are five or more features forming phases.

## Format

- Source: user feature list or references; every item passes the disposition gate (now / deferred / rejected) before landing here.
- Implementation order: phases A, B, C... from foundation to UX.
- Statuses: `done` | `now` (accepted, not yet implemented) | `deferred` | `rejected`.
- Every entry: short ID, formulation, status, reason for deferred/rejected plus a return condition.
- Implemented items are never deleted: status flips to `done` with a reference to the decision in `.docs/DECISIONS.md`.

## Entry template

```markdown
- {ID}: {feature formulation}. Status: {status} ({phase/reason}).
```

## Phases

<!-- Example:
## Phase A: Foundation
- A1: DB schema and connection. Status: done.
- A2: Routing skeleton. Status: now.
-->
