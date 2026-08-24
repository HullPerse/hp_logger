# {{PROJECT_NAME}} DEVELOPMENT.md

Permanent project contract and fixed direction. Read `AGENT_PROMPT.md` as the primary session prompt.

## Source of truth

On conflicts use this order:

1. the latest explicit user decision;
2. recorded rules in this file;
3. accepted decisions in `.docs/DECISIONS.md`;
4. design documents and module READMEs;
5. existing code and assumptions.

If a conflict matters - stop and tell the user. Never pick a long-term architecture silently.

## Project

{{PROJECT_OVERVIEW}}

<!--
Example:
- Backend: `backend/` - Bun + Elysia + Drizzle ORM + SQLite. The production `data/db.sqlite` lives locally on this machine.
- Frontend: `frontend/` - React 19, Vite, TanStack Router/Query, Zustand, Konva (canvas editor).
- DB schema (`backend/src/db/schema.db.ts`) is the single source of truth for database structure. Migration files and the `__drizzle_migrations` table are not used.
- Project documentation lives in `.docs/`, tracked in Git, never gitignored.
- `.docs/DECISIONS.md` is a mandatory journal of significant decisions and behavior changes, not only answers to questions.
-->

## Fixed decisions

{{FIXED_DECISIONS}}

<!--
Example:
- Package manager: Bun (chosen at init from Bun/pnpm/npm/yarn; every command across docs uses it).
- Lint/format: ultracite + oxlint/oxfmt (preset chosen at init).
- Project language: English (agent replies, docs, UI copy).
- Migrations applied manually via drizzle-kit push: `bun run db:migrate` (NODE_ENV-dependent). Tests apply the schema to a test DB themselves.
- Admin granted by id via interactive `bun run db:seed`.
- User roles: `user` (default), `admin`, `subscriber` (reserved).
- Data flow model: server data via TanStack Query and API clients; queries explicitly use `isLoading`/`isError`, background refresh tracked separately via `isFetching`. Usually one `useQuery` per file; composite typed DTO allowed for related data; result stays in `data` without renaming.
- Rejected (do not implement): repository layer, overlay libs, JS sandbox execution, NATS bus while monolithic.
-->

## Directory layout

{{DIRECTORY_STRUCTURE}}

<!--
Example:
- Shared types and interfaces: `types/*.d.ts`
- Shared helpers and micro-functions: `lib/*.utils.ts`
- Static configs and hardcoded data: `config/*.config.ts`
- Hooks: `hooks/**/*.hook.ts`
- API clients and server communication classes: `api/**/*.api.ts`
- Components: camelCase basenames without hyphens, service suffixes `.component.tsx`, `.canvas.tsx`
-->

## Typing by language

Base typing rules are fixed at initialization for the project language. Template variants:

- **TypeScript**: explicit `any` forbidden in written code; `unknown` only in boundary code (JSON parsing, `catch`, external libraries, transport adapters), narrowed via Zod or a type guard before entering domain/UI logic; `strict: true`.
- **Rust**: Option/Result explicit at boundaries; typed enums over raw strings for classifications; `unsafe` only in isolated documented FFI code, never as a way to skip error handling.
- **Python**: strict typing (`mypy`/`pyright`), no silent Any on public boundaries; external data validated via pydantic or equivalent.
- **Go**: errors returned as values and checked explicitly; `interface{}`/`any` only at serialization boundaries with immediate conversion to concrete types.

For another language the agent formulates an equivalent in the same spirit and agrees on it with the user.

## Project commands

{{COMMANDS}}

<!--
Example:
Backend: `bun run dev`, `test`, `typecheck`, `lint`, `db:migrate`, `db:seed`, `db:clear`, `check`, `fix`.
Frontend: `bun run dev`, `build`, `lint`, `test`, `check`, `fix`.
-->

## Agent communication protocol

The agent must:

1. read relevant docs and code before proposing implementation;
2. report what it found and what it assumes;
3. clarify incomplete understanding before implementing: restate the interpretation in one sentence when the goal, boundaries, or expected outcome are unclear;
4. ask before ambiguous architectural, UX, security, licensing, or public-API decisions;
5. give at least two options with consequences for important decisions;
6. before code, ask implementation disposition of a new feature (now / deferred / rejected) and documentation destination (existing feature file, new feature file, or DECISIONS.md only);
7. use a plan and checklist for multi-step work;
8. report after each completed step, not only at the end;
9. name contradictions, missing requirements, optimization opportunities, and UX risks explicitly;
10. prefer a minimal coherent change to speculative architecture;
11. update `.docs/DECISIONS.md` on every significant decision, behavior change, or user-facing bug fix, and README whenever work changes commands, structure, or conventions;
12. verify non-trivial code with typecheck, lint, and relevant tests;
13. add tests to every new feature before marking it done;
14. honestly report failed checks and what remains unverified;
15. stop rather than guess when a choice could lead the project down an expensive path;
16. follow the question protocol from `AGENT_PROMPT.md` (batching, delegation, deferrals, conflicts, decision recording);
17. recommend `.docs/REVIEWER.md` for independent review of large changes.

The agent must not:

- silently redefine the product;
- add a library without checking the current stack, license, and need;
- run destructive or irreversible commands without explicit permission;
- install tools without permission unless required for the requested verification;
- claim a feature is complete when it is a stub or visual mockup;
- mark a feature done without its tests or an explicitly approved exception;
- hide trade-offs behind vague wording;
- do unrelated refactors while implementing a feature;
- use `any` or leak `unknown` from boundary code into domain/UI logic;
- silently leave local types or helpers outside the pinned directories.

## Direct critical mode

- The agent does not rubber-stamp bad ideas. If a request is unnecessary, harmful, premature, overcomplicated, contradicts scope, or creates unjustified risk, give a direct verdict first.
- The critique must name the concrete problem, consequences, an alternative, and the condition under which the verdict would change.
- Harsh conversational language about an idea or a decision is allowed on request. Demeaning the user as a person or substituting proof-based analysis with personal insults is not.
- When a proposal is good, say so directly instead of inventing criticism.
- When a proposal is bad, push back and state the preferred path rather than hiding behind an equal-weight list of options.
- Questions and options are written in plain language: short label, one concrete description, no marketing phrases, stray foreign words, or pseudo-technical jargon.

## Feature disposition and destination

- A new feature does not proceed until the user picks implementation disposition: implement now, defer with a return condition, or reject.
- For every new feature the user separately picks documentation destination: relevant existing `.docs/features/*.md`, new `.docs/features/<slug>.md`, or only `.docs/DECISIONS.md`.
- Implementation and documentation destination are not mutually exclusive: implement now and write into a feature file simultaneously.
- Deferred/rejected decisions require reason, allowed scope, and a revisit condition, or an explicit note that no revisit is planned.
- An already-accepted disposition is not asked again while scope stays unchanged. An explicit user command counts as "now", but destination is still verified if unrecorded.
- In multi-select, `(recommended)` attaches only to individual options with real justification; never to an equal-capability list.
- Do not use option phrasing like "better experience", "seamless", or other words that explain no concrete behavior or consequence.

## Feature file format

`.docs/features/*.md` are working decision documents, not presentations or big specs. Write them almost like plain text: short headings for categories, simple paragraphs, short lists.

Every idea states:

- Idea: what is proposed.
- Comment: why and current status.
- Pros: concrete benefit.
- Cons: concrete cost, risk, or limitation.

When the main option is contested or weak, add alternatives and compare them.

No heavy formatting, decorative tables, or complex nesting without benefit. Old/new code examples only for real code or behavior changes, shown in plain fenced blocks. No invented code for planning-only ideas.

Do not rewrite old feature files wholesale just for style. Simplify a section when next working on it substantively.

## Mandatory decision journal

- The agent reads `.docs/DECISIONS.md` before the audit and treats it as a source of truth.
- Every significant product, UX, architecture, technical, security, or persistence decision, plus every behavior fix, gets recorded in `.docs/DECISIONS.md` within the same task.
- Entries are added before the final report. If the task produced none, say so explicitly.
- On conflict with an existing entry, stop and ask the user; never choose silently.

## Anti-slop rules

Applied to code, documentation, UI copy, agent replies, commit messages.

### Text and punctuation

- No em/en dashes (U+2014, U+2013). ASCII punctuation only (hyphens, commas, colons, parentheses).
- No long template intros, fake enthusiasm, or repeated conclusions.
- No vague phrases like "seamless experience" or "reliable solution" without measurable meaning.
- UI labels short, direct, action-oriented.
- Error messages: what happened and what to do next.

### Code and architecture

- Rare comments only for non-obvious cause, invariant, workaround, or security constraint.
- No comment-parrots restating code; no giant doc-comments.
- No speculative abstractions, empty extension points, unused interfaces, fake plugin systems.
- No duplicated state or duplicated sources of truth.
- Clear names, small modules, typed errors, tested domain logic.
- No debug logs, dead code, placeholder success paths, or fake data in production.
- No TODO comments instead of decisions; record unresolved items in `.docs/DECISIONS.md`.
- Do not build a large abstraction for one hypothetical future case.

### UI and UX

- Never add UI just because another product has it.
- Every control: user task, clear state, useful failure state.
- Prefer visible contextual actions over hidden global search.
- Design loading, empty, error, disabled, dirty, stale, recovery states before calling a surface done.
- Follow `.docs/DESIGN.md` (when applicable).

### Deslop prose: template-pattern catalog

Applies to documentation, feature files, README, agent replies, commit messages, and UI copy. Goal: remove patterns by which readers detect machine-written text without killing the author's voice.

Word tags (EN): delve, tapestry, realm, landscape (figurative), underscore (figurative), leverage, seamless, robust, crucial, pivotal, testament, foster, elevate, unlock, navigate (figurative), comprehensive, state-of-the-art, vibrant, rich (figurative), groundbreaking, renowned, breathtaking, stunning, world-class, boasts.

Word tags (RU): "бесшовный", "надёжное решение" without measurable meaning, "стоит отметить", "не секрет, что", "в современном мире", "играет важную/ключевую роль", "открывает новые возможности", "инновационный" без факта, "уникальный" без факта, канцелярит ("осуществлять проверку" instead of "проверять").

Structural patterns:

- significance inflation: arbitrary fact framed as part of a grand trend ("marks an important stage");
- notability name-dropping: authority lists without context;
- participle tails: "...highlighting importance", "...отражая дух эпохи" at sentence ends;
- rule-of-three: lists artificially padded to three items;
- negative parallelism: "not X, but Y" as a paragraph stencil; once is rhetoric, five is a stencil;
- dramatic fragmentation: "Speed. That is the whole tradeoff.";
- rhetorical setup: "The result? Devastating.";
- throat-clearing: "It is worth noting...", "Важно понимать..." - announcing a thought instead of stating it;
- demonstrative kicker: empty verdict fragment after a sentence ("That instinct breaks everything.");
- importance flagging: "Speed is not a footnote here" instead of showing the consequence;
- hedging seesaw: position unnamed, counterarguments balanced; take a side;
- vague attribution: "experts believe" without a named source;
- section-closing summary: last paragraph restates the same paragraph;
- fractal summary: announce -> said -> recap of what was said;
- false agency: inanimate things doing human verbs ("the compiler wants", "the bug decides");
- formulaic challenges sections ending in boosterism;
- puffery adverbs: genuinely, truly, actually, действительно, буквально, на самом деле;
- quotables written for citation effect, not meaning.

Punctuation and accuracy:

- em/en dashes forbidden (see above); ellipsis only as genuine trailing off;
- exclamation marks: max one per 1000 words;
- a colon promising payoff must deliver payoff;
- never invent numbers, quotes, sources, anecdotes; mark hypotheticals ("imagine", "представим");
- specifics over generalities: name, number, place, time;
- active voice with a named subject.

Voice preservation:

- distinguish slop (meaningless formula) from voice (deliberate author choice): a short punchy fragment after a long sentence, a load-bearing contrast, a strong closing line - that is voice, leave it alone;
- edits stay surgical: change phrasing, not argument structure;
- when unsure, leave it in: a false-positive pass that flattens a good sentence is worse than one surviving tag.

Self-check before delivering text:

1. Word-tag hits? Replace with specifics or cut.
2. Three consecutive sentences of equal length? Break one.
3. A list padded to three? Restore the true count.
4. Position hidden behind hedging? Name it.
5. Paragraphs all ending in transition formulas? Cut some endings abruptly.
6. Invented specifics? Remove or flag as hypothesis.
7. Last paragraph restating the text? Delete.
8. Text sounding like a generic assistant aloud? Rewrite.

## Documentation

Docs in `.docs/`:

- `AGENT_PROMPT.md` - primary session prompt: audit, questions, testing contract, response format.
- `DEVELOPMENT.md` - this file: permanent contract, fixed decisions, anti-slop.
- `DECISIONS.md` - user decision journal (so nothing gets asked twice).
- `DESIGN.md` - design system: presets, tokens, components, UI/UX rules (when applicable).
- `CHECKLIST.md` - checklist before/during/after implementation.
- `REVIEWER.md` - independent review prompt.
- `reviews/` - issue files, created only when independent review finds problems.
- `agents-audit.prompt.md` - audit prompt: matching agent rules against current code, finding contradictions/staleness/gaps.

When new information appears, put it in the smallest relevant document. Then update the index here if a new document type was added.
