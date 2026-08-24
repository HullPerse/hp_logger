---
name: docs-onboard
version: 1.0.0
description: >
  Connect a fresh agent chat to a project that already has AGENTS.md and a filled
  .docs/ directory. Reads the entry point, follows its mandatory reading list, checks
  available MCP tools, and returns a compact session contract summary so the agent
  immediately works by the project rules instead of guessing them. Use at the start of
  any session in such a project, when the user says "прочитай доки", "онбордь",
  "загрузи правила проекта", or when AGENTS.md exists with references to .docs/.
  Not for projects with placeholder .docs/ - use the hp-docs first-run flow there.
---

# Docs Onboard

Connects a fresh agent to a project with existing documentation. Outcome: the agent in the current chat works strictly by the project rules and visibly proves it has read them.

## Precondition

A root `AGENTS.md` (or equivalent: CLAUDE.md) references a filled `.docs/`. When files contain `{{...}}` placeholders - do not onboard; suggest the first-run flow from the `hp-docs` skill.

## Procedure

1. **Entry point**: read root `AGENTS.md` fully. Extract: mandatory reading list, key rules, quick-start commands.
2. **Mandatory reading**: walk the entry-point list in order. Minimum for a complete contract:
   - `.docs/AGENT_PROMPT.md` - session contract;
   - `.docs/DEVELOPMENT.md` - conventions, fixed decisions, typing by language, data-flow model;
   - `.docs/DECISIONS.md` - decision journal;
   - `.docs/DESIGN.md` - when UI is affected;
   - `.docs/CHECKLIST.md` - before implementation;
   - feature files relevant to the user's task, when already known.
   Never defer list items to "read later": without them the contract is incomplete.
3. **MCP tools**: enumerate available servers in one action (mandatory check from AGENT_PROMPT).
4. **Contract summary** - output compactly into the current chat:

```markdown
## Project contract: {{NAME}}

Stack: ...
Commands: lint/typecheck/test via ...

Hard rules (top level):
- ...
- ... (7-10 items max)

Source-of-truth hierarchy: user > DEVELOPMENT > DECISIONS > design/README > code.

Recent decisions from DECISIONS.md (date + heading):
- ...
- ...

Open dispositions / roadmap tails: ... or "none".

Unverified areas: ... or "everything read".
```

5. **Ready**: ask for the task if the user has not named one yet. From now on work by the full contract without re-reading in this session.

## Constraints

- Onboarding changes nothing: no code, no `.docs/`, no settings.
- Never retell documents in full: only the summary above. Long retellings are slop too.
- When documents contradict each other - surface the contradiction as a finding and ask; never choose silently.
- When a mandatory file is missing or empty - say so plainly and suggest restoring from the `hp-docs` templates.
