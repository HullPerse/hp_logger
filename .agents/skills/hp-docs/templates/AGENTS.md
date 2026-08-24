# {{PROJECT_NAME}} agent rules

Full agent rules live in `.docs/`. Read them before working.

## Mandatory

1. Read `.docs/AGENT_PROMPT.md` - the session contract (audit before code, response format).
2. Read `.docs/DEVELOPMENT.md` - conventions, anti-slop rules, accepted decisions.
3. Read `.docs/DESIGN.md` before any UI/UX work.
4. Read `.docs/CHECKLIST.md` before implementation and review.
5. Analyze `.docs/DECISIONS.md` at the start of every task and again before any question (the answer or constraint may already be recorded). After every significant decision or behavior change, append an entry to `.docs/DECISIONS.md` before finishing the task.
6. Read module README and package.json before working in the respective directory.
7. If `product-spec.md` exists in the root - it is the source of truth for the feature set; read it before dispositioning new features.
8. Use `.docs/agents-audit.prompt.md` to verify that agent rules are not stale and still match the code.

## Key rules

- **Audit first, code second.** Find problems before implementing anything; classify findings (Blocker/Risk/Gap/Optimization/Clear); stop and ask on a Blocker.
- **Clarify what you did not fully understand.** If the goal, boundaries, or expected outcome of a task are unclear, restate your interpretation in one sentence and ask before implementing. Never guess where a misunderstanding would lead to wrong scope.
- **Ask questions to avoid doing harm.** Do not assume on contested decisions. But never ask questions that documentation or code already answer.
- **Do not rubber-stamp bad ideas.** If a request or solution is truly unnecessary, harmful, contradicts the product, creates unjustified complexity, or leads to bad architecture, the agent must say so directly and argue for a better option. Harsh language about an idea or a decision is allowed, always with concrete explanation: what exactly is bad, why, what the consequences are, what to do instead, and what would change the verdict. Never demean the user as a person and never substitute proof-based analysis with personal insults.
- **Write questions in plain language.** Labels and descriptions must be short, concrete, and free of marketing filler. No stray foreign phrases, no pseudo-technical jargon, nothing hiding the absence of thought behind words like "scope", "pipeline", "seamless". Keep a technical term only when it carries meaning, and explain it plainly.
- **Write feature files almost like plain text.** In `.docs/features/*.md` use short headings only to separate categories. Every idea must include: idea, comment, pros, cons. If an idea is contested or weak, add alternatives. No heavy formatting, decorative tables, or deep nesting without benefit. Add old/new code examples only when they help understanding; put each example in a plain fenced block.
- **Mark recommendations.** When proposing options, mark the recommended one `(recommended)` and explain why. Do not add `(recommended)` when options are equivalent.
- **Feature disposition is mandatory.** Before implementing each new feature or significant change, the agent asks two decisions: implement now / defer / reject, and where to document - existing `.docs/features/*.md`, a new `.docs/features/<slug>.md`, or only `.docs/DECISIONS.md`. For a small bug fix or a change without separate feature documentation, state this explicitly.
- **"You decide" = delegation.** The agent may pick a justified `(recommended)` option and record the delegated ownership.
- **DECISIONS.md is mandatory.** The agent analyzes `.docs/DECISIONS.md` before audit and implementation, treats it as a source of truth, and appends every significant product, UX, architecture, or technical decision plus every behavior fix. Never finish a task with such a change left unlogged.
- **Check packages first.** Before implementing a non-trivial task, inspect installed dependencies, their versions, existing usage sites, and documentation. If no ready-made solution exists in the project, propose several modern candidate packages with trade-offs and a recommendation instead of writing a replacement from scratch or adding a dependency silently.

## First run

If `.docs/` contains `{{...}}` placeholders - this is the first run. Read `first-run.md` and execute it: fill the templates, then offer a deep analysis of the existing project or initialization of a new one. All strict rules apply during the first run as well.

## Available tools

At session start the agent must list available MCP servers and tools, and use them whenever the task matches: library docs via context7 before answering from memory, browser tools for UI verification. Full rule: `.docs/AGENT_PROMPT.md`, section "Available tools". Do not overuse calls.
