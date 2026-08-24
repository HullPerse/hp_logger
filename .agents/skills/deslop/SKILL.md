---
name: deslop
version: 1.0.0
description: >
  Remove machine-writing tells from prose while preserving the author's voice.
  Consolidated catalog merged from ten upstream anti-slop skills (anti-ai-slop-writing,
  humanize/soundshuman, anti-slop, deslop, humanizer, slopbeth, unslop, blader/humanizer,
  no-ai-slop, stop-slop). Applies to documentation, README files, feature files, agent
  answers, UI copy, and commit messages - NOT to source code structure. Use when drafting,
  editing, or reviewing any text that must not read as AI-generated, when auditing a docs
  folder for slop, or on triggers like "deslop", "sounds like AI", "make it human",
  "remove slop".
---

# Deslop

Strip predictable machine-writing patterns from text. Make prose sound like a specific
person wrote it. The goal is not blandness: sterile, voiceless text is its own tell.

## Prime directive: preserve voice

Before deleting anything, decide whether a candidate is **slop** (formula carrying no
meaning) or **voice** (a deliberate choice the author would defend). A short punchy
fragment after a long sentence, a load-bearing contrast, one deliberate tricolon, a
strong closing line: these are voice. Cut filler and formula. Keep earned rhythm.
When unsure, leave it in. A false positive that flattens good prose is worse than one
surviving tell. Make surgical phrasing edits; do not restructure arguments.

## Scope

Applies to: `.docs/**` texts, README, feature files, agent chat answers, UI copy,
commit messages, release notes. Does not govern code architecture (see AGENT_PROMPT.md
section on ponytail) and does not override project language rules.

## Word tags

English: delve, tapestry, realm, landscape (figurative), underscore (figurative),
leverage, seamless, robust, crucial, pivotal, testament, foster, elevate, unlock,
navigate (figurative), comprehensive, state-of-the-art, vibrant, rich (figurative),
groundbreaking, renowned, breathtaking, stunning, world-class, boasts, deeply,
structurally, fundamentally, genuinely, truly, actually, quietly, effortlessly.

Russian: "бесшовный", "надёжное решение" without measurable meaning, "стоит отметить",
"не секрет, что", "в современном мире", "играет важную/ключевую роль", "открывает новые
возможности", "инновационный" без факта, "уникальный" без факта, канцелярит
("осуществлять проверку" вместо "проверять"), "мощный инструмент" без измеримого смысла.

If reaching for a tag, replace it with a concrete specific alternative or restructure
the sentence.

## Structural tells

| Tell | Fix |
| --- | --- |
| Significance inflation: arbitrary fact framed as part of a grand trend | State the fact plainly |
| Notability name-dropping: authority lists without context | Keep only cited-with-context sources |
| Participle tails: "...подчёркивая важность", "highlighting...", "underscoring..." tacked onto ends | Delete or make a separate claim |
| Rule of three: every list padded to three items | Use the true count: one, two, four, five |
| Parataxis chains: three short declarative sentences in a row | Connect with subordinate clauses, conjunctions, semicolons |
| Negative parallelism as template: "not X, but Y" in every paragraph | Keep the single load-bearing contrast, rewrite the rest plainly |
| Dramatic fragmentation: "Скорость. Вот и весь трейдофф." | Fold into a full sentence |
| Rhetorical setup: "Результат? Разрушительный." | State the result directly |
| Meta throat-clearing: "Стоит отметить, что...", "It is worth noting..." | Delete the frame, state the thing |
| Demonstrative kicker: vague verdict fragment after a sentence ("That instinct backfires.", "Этот инстинкт и ломает всё.") | Cut it or pivot with a real transition ("But...") |
| Importance flagging: "Здесь скорость не мелочь.", "Make no mistake." | Show the consequence instead |
| Hedging seesaw: position never taken, counterpoints balanced | Pick a side; acknowledge objections in one sentence max |
| Vague attribution: "эксперты считают", "research shows" | Name the source or cut the claim; never invent one |
| Section-closing summary restating the paragraph | Delete |
| Fractal summary: announce -> say -> recap what was said | Say once |
| False agency: inanimate things doing human verbs ("the complaint becomes a fix") | Name the actor, use active voice |
| Formulaic challenges/outlook sections ending in boosterism | Write about real problems with specifics |
| Puffery adverbs adding heat not light | Delete; if the claim needs the adverb, the claim is weak |
| Clever metaphor flourishes performing wit | State it plainly |
| Grandiose predictions ("will define the next decade") | Scope to a defensible concrete claim |
| Quotables written for pull-quote effect | Rewrite for meaning |
| Uniform sentence lengths (three consecutive same-length sentences) | Mix 4-word and 30-word sentences; the most measurable detection signal |

## Punctuation limits

- Em/en dash: forbidden outright by project rules (ASCII punctuation only).
- Ellipsis: only for genuine trailing off, max once per piece, never as transition.
- Exclamation marks: max one per 1000 words.
- Colons: what follows the colon must deliver on the promise set up before it.
- Semicolons: fine to use where two clauses are truly joined.

## Accuracy and honesty

- Never invent numbers, studies, quotes, anecdotes, or sources. Fabricated specificity
  kills trust faster than honest vagueness.
- Hypotheticals stay hypothetical: mark them ("представим", "imagine").
- Prefer verifiable names, dates, places over generic references.
- Be specific by default: "34 users in week one, 12 returned" beats "significant growth".

## Formatting tells

- No markdown headers in social posts, emails, DMs, plain-text contexts.
- No bold-first bullets (every item starting with a bolded keyword); no unicode arrows.
- No emoji as bullet points; no "Thread:" openers; no hashtag stacks beyond two.
- Bullets sparingly and unevenly; if it fits a sentence, write the sentence.
- No signposted conclusions ("In conclusion...", "Итак, подведём итог").

## Voice calibration

When writing as a specific person or brand, analyze their sample first: sentence
lengths, vocabulary, openings, recurring phrases, humor style, what they would NEVER
say. A sample outranks this skill's style rules, including matching its em-dash
frequency where project rules permit. Default without a sample: direct, slightly
informal, contractions, trusts the reader, occasionally starts with "And"/"But".
For encyclopedic, technical, legal, reference text, neutral and plain IS the correct
voice: do not inject personality there.

## Process

Drafting: write first, then run the audit pass on your own draft. Do not self-censor
into blandness mid-draft.

Auditing a text:

1. Read the whole piece; note the voice you are preserving.
2. Collect candidate tells against the tables above; do not edit yet.
3. Validate each candidate: slop or voice? Discard false positives.
4. Apply surviving edits one at a time, each a minimal phrasing change.
5. Re-read edited passages for rhythm; fix anything now choppy or flat.
6. Preserve all information: every claim survives into the rewrite even when shape
   changes. Depth may be redistributed, facts may not be added.

Scoring before delivery (1-10 each): directness, rhythm variety, reader trust,
authenticity, density. Below 35/50: revise. One pass of edits is usually enough;
endless polishing is its own form of slop.

## Self-check before delivering text

1. Any word-tag hits? Replace with concrete alternatives.
2. Three consecutive same-length sentences? Break one.
3. Any parataxis chain of three or more? Merge with connective tissue.
4. Lists forced to three? Restore the real count.
5. Position hedged into mush? Take it.
6. Paragraphs all ending in transition formulas? Cut some endings abruptly.
7. Invented specifics anywhere? Remove or flag as hypothesis.
8. Throat-clearing openers left? Delete the frame, keep the substance.
9. Could any model have produced this text for any person? Add something only this
   context knows.
10. Voice flattened by edits? Restore one earned rhythm.

## Lineage

Merged and deduplicated from: jalaalrd/anti-ai-slop-writing, aashaexo/soundshuman
(humanize), elithrar/dotfiles (anti-slop), stephenturner/skills (deslop),
aboudjem/humanizer-skill (humanizer), ehmo/slopkit (slopbeth), cursor/plugins (unslop),
blader/humanizer, petergyang/no-ai-slop, hardikpandya/stop-slop. The Russian tag list
and project-specific punctuation bans come from this repository's rules.
