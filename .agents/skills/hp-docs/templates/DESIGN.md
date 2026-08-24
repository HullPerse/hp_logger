# {{PROJECT_NAME}} Design System

Source of truth for UI/UX (when applicable). Rules apply to code, new components, and reviews.

## 0. Preset selection

The design preset is chosen at project initialization and recorded in `.docs/DECISIONS.md`. The default is "Scandinavian". A user-defined style rewrites section 1 for that preset; the remaining rules (states, a11y, bans) stay.

| Preset | When to choose |
| --- | --- |
| Scandinavian `(recommended)` | Web and product interfaces by default: calm black-and-white base, restrained typography |
| Neo-brutalism | When the user explicitly wants a harsh high-contrast style: radius 0, thick borders, hard shadows, monospace font |
| Zed dark | Native desktop applications (GPUI/compact tools): dark theme, high information density |

For non-UI projects (CLI, backend-only) keep only this section and section 5, or delete the file entirely.

## 1. Preset "Scandinavian" (default)

A calm functional interface on a neutral black-and-white base. Simplicity is not minimalism: remove what is unnecessary so the primary task becomes obvious, but add labels, boundaries, and density when they aid comprehension. Quiet must never mean empty or vague.

### Color: ink via alpha, not gray paint

Intermediate tones are built with alpha black over white, without warm or cool gray casts:

| Role | Value | Purpose |
| --- | --- | --- |
| Canvas / Surface | `#FFFFFF` | Page and panel background |
| Primary ink | `#000000`, 90-100% | Body text, critical icons |
| Secondary ink | `rgb(0 0 0 / 64%)` | Supporting text |
| Tertiary ink | `rgb(0 0 0 / 44%)` | Metadata, optional glyphs; lift to ~56% for readable text on dense screens |
| Border | `rgb(0 0 0 / 10%)` | Separators |
| Strong border | `rgb(0 0 0 / 18%)` | Field and card outlines |
| Hover fill | `rgb(0 0 0 / 5%)` | Hover state |
| Pressed fill | `rgb(0 0 0 / 9%)` | Pressed, selected |
| Scrim | `rgb(0 0 0 / 44%)` | Modal backdrop |

Color rules:

- Hierarchy comes from opacity rungs, not new colors. Set ink with an alpha color, never CSS `opacity`.
- One brand accent may exist for the primary action only; no decorative accents.
- The logo keeps its brand color; third-party logos in social-proof lists go monochrome.
- Product screenshots and media keep their own colors; never repaint them with tokens.
- Dark theme: canvas near `#0A0A0A`, white primary ink, secondary ~`rgb(255 255 255 / 56%)`, tertiary ~36%; hover ~9%, pressed ~14%. Never carry light-theme alphas over one-to-one.
- Validate contrast instead of assuming: lower rungs fail 4.5:1 by design and are meant for optional content only.

### Typography

- One sans-serif: existing quality font of the project > system stack > Inter Variable.
- Body 16-18px, weight 400, line-height 1.5-1.6; labels and controls weight 500; headings 500-600, never 700+.
- Large headings: line-height 1.05-1.15, slight negative tracking.
- No all-caps or forced uppercase in buttons, navigation, badges; sentence case everywhere.
- 3-4 distinct text styles per screen; hierarchy through size and whitespace, not many weights.
- Prose width 55-68 characters.

### Spacing and structure

- 8px rhythm, 4px adjustments allowed. Mobile margins ~24px, desktop 40-64px.
- Long pages compose into spacious chapters (96-144px transitions), not stacks of similar cards.
- Whitespace separates before lines do; add a line only when something stays ambiguous without it.
- A heading belongs to the content below it: gap above roughly three times the gap below.
- Left-align all text by default including headings, labels, footers; centering is a rare deliberate exception.
- One icon family, one stroke weight, monochrome; emoji are not icons.
- Element weight follows usage frequency: the least-used control in a region must never be its heaviest element.

## 2. Preset "Neo-brutalism"

Flat surfaces, hard 2px borders, zero border radius, blur-free hard shadows, monospace font. Hierarchy built from color blocks and shadow.

- `:root` tokens: background, card, border (#000), text (#000), muted, primary, secondary, accent, success, error; semantic Tailwind utilities instead of hardcoded hex.
- Typography: monospace family (e.g. JetBrains Mono), weight 600, 20px base; buttons text-sm font-extrabold.
- `border-radius: 0` globally; borders `border-2`; hard shadows `4px 4px 0 0 var(--border)` and `2px 2px 0 0`.
- Components: Button (default/error/success/ghost/link, loading/disabled), Input (password show/hide, number arrows, length counter), Modal (blur overlay + fade/zoom 100ms, close button with sr-only label), Switch, Checkbox, Slider.
- Thin scrollbar, primary on background, 2px border.

## 3. Preset "Zed dark" (desktop/GPUI)

Dark compact editor-grade theme for native tools. One neutral scale carries surfaces, one accent marks interaction and focus.

- Tokens: background `#111110`, surface `#191918`, element `#222221`, border `#3b3a37`, border_focused `#004074`, text `#eeeeec`, text_muted `#b5b3ad`, primary `#0090ff`, danger `#e5484d`, warning `#ffe629`, success `#46a758`; plus semantic classification colors (protected, unknown, cache, build, user_data).
- Typography: system font; 16px page titles, 14px body/buttons, 12px metadata, 10px badges.
- Radii 4/6/8px; 1px borders, 2px `border_focused` focus; tab bar 32px, buttons 26px tall.
- No decorative gradients or glow; 100-150ms ease-out color transitions.

## 4. Components (common requirements)

Regardless of preset, every component is described before implementation:

- Variants, sizes, props (loading, disabled, rendered).
- States: normal, hover, active/pressed, focus-visible, disabled, error.
- Real surface states: loading, empty, error, dirty, stale, recovery.

## 5. A11y and required states

- Every interactive element has a visible focus indicator of at least 2px.
- Icon-only controls get `sr-only` labels; keyboard navigation is mandatory.
- Color is never the only state signal: duplicate with text or shape.
- Interface language is fixed at initialization.

## 6. Rules

- Never create a second component when an analog exists in shared directories.
- Never hardcode colors, radii, or spacing; use the preset's tokens only.
- Never change the preset or its global rules without an explicit user decision recorded in `.docs/DECISIONS.md`.
- Every visual choice must be defensible by product benefit: comprehension, hierarchy, task speed, or accessibility - not "it looks nice".
