---
name: docs-init
version: 1.0.0
description: >
  Install and initialize the hp_docs documentation package in any project from scratch.
  Detects whether the HullPerse/hp_docs skills are already installed, installs them via
  npx/bunx/pnpm dlx (git clone as fallback), verifies the installation, then hands off to
  the first-run flow which asks all initialization questions. Use when the user says
  "install hp_docs", "install ai-docs", "set up docs", "инициализируй документацию", "подключи доки", or
  when .agents/skills/ contains hp-docs but the project root has no AGENTS.md and no .docs/.
---

# Docs Init

Installs the hp_docs package into a project and initializes its documentation. End state: skills discoverable in `.agents/skills/`, root `AGENTS.md` present, full `.docs/` generated with real project data and all initialization questions answered.

This skill handles installation only. The questions about documentation language, package manager, lint preset, design preset, and product spec belong to the first-run flow - never ask them here.

## Step 1: Detect the installation state

Check, in order:

1. `.agents/skills/hp-docs/SKILL.md` exists -> skills are installed; go to step 3.
2. Nothing installed:
   a. `node` available (`node --version`) -> go to step 2.
   b. No node/npm/bun/pnpm on the machine -> go to step 2 fallback.
3. Root `AGENTS.md` AND `.docs/` both exist -> this project is already initialized; do not run this skill. Suggest `docs-onboard` instead.

If `.docs/` exists but is partial (placeholders) - do not overwrite anything; suggest completing via the first-run flow directly.

## Step 2: Install

Ask one question: which runner to use?

- npx `(recommended)` - ships with Node.js
- bunx - if the machine uses Bun
- pnpm dlx - if the machine uses pnpm

Then execute from the project root:

```bash
<runner> skills add HullPerse/hp_docs --skill '*' -y
```

Notes:

- The install targets `.agents/skills/` by default - the universal directory read by OpenCode, Codex, Cursor, Amp, Gemini CLI, Copilot and most other agents. For non-standard agent targets mention the `-a <agent>` flag of the CLI instead of guessing.
- On Windows, symlink creation may fail without Developer Mode. If the command errors on symlinks, re-run with `--copy`.
- The CLI installs a snapshot of the repository's default branch at the moment of running. It does not auto-update.

### Fallback without node

No JS runtime available:

```bash
git clone https://github.com/HullPerse/hp_docs /tmp/hp_docs
mkdir -p .agents/skills
cp -r /tmp/hp_docs/skills/* .agents/skills/
rm -rf /tmp/hp_docs
```

On Windows use PowerShell equivalents with explicit UTF-8-safe copy operations (Copy-Item is byte-exact and safe).

## Step 3: Verify

Before continuing, confirm:

1. `.agents/skills/hp-docs/templates/` directory exists and contains template files.
2. All six skills present: `hp-docs`, `deslop`, `scandinavian-design`, `docs-refactor`, `docs-onboard`, `docs-init`.
3. Every installed `SKILL.md` has YAML frontmatter with `name` and `description`.

Any miss - report what is broken and stop; a broken install must not bootstrap half-initialized docs.

## Step 4: Hand off to first-run

Read the installed files and execute the full first-run flow from them:

- `.agents/skills/hp-docs/SKILL.md` - the master flow description;
- `.agents/skills/hp-docs/templates/first-run.md` - the step-by-step procedure.

From this point the docs-init skill is done: first-run performs the MCP check, project scan, asks the six initialization questions in one batch, generates `AGENTS.md` + `.docs/` from templates, runs the health check. Do not duplicate or pre-answer its questions here.

## Step 5: Report

Finish with:

- what was installed (method, runner, target directory);
- what was created during initialization (file tree);
- how to update later: `<runner> skills update hp-docs` (or reinstall for a pinned version via a tag tree URL: `<runner> skills add https://github.com/HullPerse/hp_docs/tree/<tag>/skills`);
- next concrete action for the user.

## Rules

- Never modify files inside `.agents/skills/` after installation: they are managed by the CLI and will be overwritten on update.
- Never copy templates into the project manually before the first-run flow asks its questions: generation happens inside that flow, in the chosen language and presets.
- If the user wants a specific version, pin it via the tag tree URL instead of installing main.
- Installation commands download code from GitHub - state this plainly before running them.
