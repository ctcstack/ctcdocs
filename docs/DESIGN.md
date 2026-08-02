---
name: CTCStack Knowledge Base
description: A flat, hairline-ruled documentation surface on a zero-chroma neutral ramp, where one orange accent carries every meaning.
colors:
  accent-ember: '#ed6b2d'
  accent-ember-light: '#b23c00'
  accent-wash-dark: '#3a1a0a'
  accent-wash-light: '#fdece2'
  accent-lift-dark: '#f7a877'
  accent-deep-light: '#8a2e00'
  ground-dark: '#141414'
  ground-light: '#fcfcfc'
  sunken-dark: '#0f0f0f'
  sunken-light: '#f7f7f7'
  ink-strong-dark: '#f5f5f5'
  ink-strong-light: '#171717'
  ink-body-dark: '#ededed'
  ink-body-light: '#181818'
  ink-muted-dark: '#a1a1a1'
  ink-muted-light: '#6b6b6b'
  hairline-dark: '#333333'
  hairline-light: '#e4e4e4'
  border-strong-dark: '#4a4a4a'
  border-strong-light: '#d6d6d6'
  inline-code-dark: '#232323'
  inline-code-light: '#f0f0f0'
typography:
  headline:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '2.1875rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '1.3rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.015em'
  subtitle:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '1.1rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  body:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: 'normal'
  meta:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.75
    fontFeature: 'tabular-nums'
  label:
    fontFamily: 'Inter Variable, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 600
    letterSpacing: '0.06em'
  code:
    fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace'
    fontSize: '0.875rem'
rounded:
  none: '0'
  sm: '0.25rem'
  md: '0.5rem'
spacing:
  2xs: '0.25rem'
  xs: '0.5rem'
  sm: '0.75rem'
  md: '1rem'
  lg: '1.5rem'
  xl: '2rem'
  2xl: '2.5rem'
components:
  index-row:
    textColor: '{colors.ink-strong-dark}'
    typography: '{typography.body}'
    padding: '0.7rem 0'
  index-row-hover:
    textColor: '{colors.accent-ember}'
  index-row-date:
    textColor: '{colors.ink-muted-dark}'
    typography: '{typography.meta}'
    width: '8.5rem'
  onboarding-card:
    textColor: '{colors.accent-ember}'
    rounded: '{rounded.md}'
    padding: '0.875rem 1rem'
  group-label:
    textColor: '{colors.ink-muted-dark}'
    typography: '{typography.label}'
    padding: '0 0 0.5rem'
  provenance-fact:
    textColor: '{colors.ink-strong-dark}'
    typography: '{typography.meta}'
  provenance-action:
    textColor: '{colors.ink-muted-dark}'
    typography: '{typography.meta}'
    padding: '0'
  provenance-action-hover:
    textColor: '{colors.accent-ember}'
  code-frame:
    backgroundColor: '{colors.sunken-dark}'
    typography: '{typography.code}'
    rounded: '{rounded.md}'
  pagination-link:
    textColor: '{colors.ink-strong-dark}'
    typography: '{typography.body}'
    padding: '0.75rem 1rem'
  sidebar-link-current:
    backgroundColor: '{colors.sunken-dark}'
    textColor: '{colors.accent-ember}'
    typography: '{typography.meta}'
  toc-link-current:
    textColor: '{colors.accent-ember}'
    typography: '{typography.meta}'
    padding: '0 0 0 1rem'
---

# Design System: CTCStack Knowledge Base

## Overview

**Creative North Star: "The Provenance Ledger"**

A ledger is flat, ruled, dated, and neutral, and it earns trust by showing its
own record rather than describing it. This interface is built the same way. The
home page is not a set of section cards promising that knowledge exists; it is
the corpus itself, every document listed with the date its Google Doc was last
edited by a person. Every surface below it keeps that register: a single sheet
of paper divided by one-pixel rules, with one stamped color.

The system is a zero-chroma neutral ramp in both themes plus one chromatic
accent — the CTCStack orange from the company mark. Because there is no second
hue and no shadow, hierarchy has to be carried by tone, weight, tracking, and
rules. That constraint is the discipline of the whole system: when a thing must
stand out, the answer is one step of ink, not a new color; when two regions must
separate, the answer is one hairline, not a fill. The accent is spent only on
where-you-are, what-you-are-hovering, and what-has-focus.

Density is documentation density, not marketing density. The type scale tops out
at 35px and headings gain their authority from semibold weight and negative
tracking rather than size, because a page whose title is four times its body
text wastes the first viewport of a reference document. The visual authority is
the Cloudflare developer documentation, adopted as a working system rather than
as a resemblance, and recorded in `docs/ADR/011-documentation-design-language.md`.
The rejections are equally deliberate: no section-card landing, no saturated
navigation fill, no floating cards, no marketing hero.

**Key Characteristics:**

- Zero-chroma neutral ramp; a single accent hue carries all meaning
- Flat surfaces separated by 1px hairlines, never by fills or shadows
- A tight documentation type scale (max 2.1875rem), semibold with negative tracking
- Provenance above the prose: every document states its source freshness first
- Contrast is an enforced gate — every pair is measured on its actual ground
- Multilingual by construction: Latin and Cyrillic in one page, self-hosted

## Colors

A neutral gray ramp held at zero chroma in both themes so that a single orange
is the only chromatic event on any screen.

### Primary

- **Ember Orange** (dark theme accent, and the mark in both themes): the sole
  chromatic color. It marks the current sidebar page, the active table-of-contents
  section, hover targets, focus rings, and the wordmark. It measures 5.91:1 on the
  dark ground.
- **Ember Deep** (light theme accent): the same hue darkened. The dark-theme
  orange measures only 3.04:1 on the light ground, which fails WCAG AA for text,
  so the light theme substitutes a darkened tone at 5.78:1. This is a measured
  substitution, not a preference.
- **Ember Wash** (dark and light variants): the low tint used for accent-tinted
  backgrounds Starlight requests (asides, selection surfaces). Never used for text.

### Neutral

- **Ground** (`#141414` dark / `#fcfcfc` light): the page ground, and equally the
  header ground and the sidebar ground. Those three are the same sheet.
- **Sunken** (`#0f0f0f` dark / `#f7f7f7` light): the one recessed surface — code
  frame interiors, the current sidebar item, keyboard keys. It replaces elevation.
- **Ink Strong** (`#f5f5f5` dark / `#171717` light): titles, index entry titles,
  the leading fact in a provenance row, the count in the corpus band.
- **Ink Body** (`#ededed` dark / `#181818` light): running prose.
- **Ink Muted** (`#a1a1a1` dark / `#6b6b6b` light): metadata, breadcrumbs, dates,
  group labels, blockquotes, secondary actions. The lowest tone that is still text.
- **Hairline** (`#333333` dark / `#e4e4e4` light): every structural division in the
  system. Deliberately set brighter than the visual authority's own value, which
  sits at the threshold of visibility rather than functioning as a rule.
- **Border Strong** (`#4a4a4a` dark / `#d6d6d6` light): the hover state of a
  hairline box, blockquote rules, keyboard-key borders.

### Named Rules

**The Single Chroma Rule.** Every neutral in this system is chromatically
neutral in both themes. A ramp that is warm in one theme and neutral in the
other is two systems. If a new surface needs emphasis, it takes a step of ink or
a hairline — never a second hue.

**The Two-Ground Accent Rule.** The accent is two values, one per ground, and
each is chosen by measured contrast against that ground. Never carry the dark
accent into the light theme for text, and never introduce a token whose contrast
has not been measured: `tests/ux/wiki.spec.ts` asserts zero Axe violations in
both themes, so contrast is a gate rather than a guideline.

**The Mark Exemption Rule.** Unmodified `#ed6b2d` is used on the CTCStack mark
in both themes, because a logo is artwork rather than text and is not subject to
the text contrast floor. Nothing else may claim that exemption.

**The Reserved Accent Rule.** The accent means location, intent, or focus:
current page, current section, hover target, focus ring, the wordmark, the one
onboarding entry. It never decorates a border, a heading, a divider, or a
background band.

## Typography

**Body Font:** Inter Variable (with `system-ui`, `sans-serif`)
**Code Font:** JetBrains Mono Variable (with `ui-monospace`, `monospace`)

Both are self-hosted as per-subset woff2 with `unicode-range`, imported from
`src/components/Head.astro` so the dependency is a traceable module edge. There
is no external font CDN: the site sits behind Cloudflare Access and must not
depend on a third-party origin. An English page never downloads Cyrillic, and a
document without code never downloads the monospace family.

**Character:** Neutral, dense, and unfussy. Inter is chosen for its Cyrillic
coverage as much as its Latin — bodies mix Russian, Ukrainian, English, and
Spanish inside a single page and the type must hold that without special-casing.
JetBrains Mono gives code a distinctly different texture without a second voice.

### Hierarchy

- **Headline / h1** (600, 1.75rem mobile → 2.1875rem at ≥50em, line-height 1.25,
  tracking −0.025em): the document title. This is the largest type in the system;
  there is no display role above it.
- **Title / h2** (600, 1.3rem, tracking −0.015em): major sections inside a document.
- **Subtitle / h3** (600, 1.1rem, tracking −0.01em): subsections.
- **h4 / h5** (600, 1rem / 0.9375rem): deep structure; separated from body by
  weight alone.
- **Body** (400, 1rem, line-height 1.75): prose, held to a 46rem measure
  (roughly 67 characters).
- **Meta** (400, 0.875rem, muted, `tabular-nums`): dates, breadcrumbs, provenance
  actions, pagination captions, the corpus band. Numerals are tabular so date
  columns align down the page.
- **Label** (600, 0.875rem, uppercase, tracking 0.06em, muted): folder group
  headings on the corpus index.
- **Code** (0.875rem): inline code and code frames.

### Named Rules

**The Documentation Scale Rule.** Headings are fixed at their documentation
sizes and do not grow on wide viewports the way the framework's defaults do.
Hierarchy comes from weight (600) and negative tracking, not from size. Nothing
larger than 2.1875rem exists in this system.

**The Space Above Rule.** A heading owns the space above it (2.5rem) and almost
none below it (0.75rem to its first sibling), so a section reads as one block
rather than as a floating label.

**The Bounded Label Rule.** Uppercase, tracked, muted type is reserved for real
section headings that label a group of content — folder groups on the index. It
is never used as a decorative kicker or eyebrow above a title.

## Layout

A three-column reading shell: sidebar, content, table-of-contents rail. All three
share the page ground; the sidebar is divided from the content by a single
inline-end hairline and the sticky header by a single bottom hairline. Nothing
is a panel.

Measures are per-surface. Prose runs at 46rem, which holds roughly 67 characters.
The corpus index runs wider at 52rem because it carries a right-aligned date
column, and a date a thousand pixels from its title is not a pair the eye can
read — the splash template's full-width container is capped to that measure, and
the page title shares the cap so index and title align on one left edge.

Spacing rhythm is a small ladder in rem: 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 2.5.
Index rows are 0.7rem vertical; folder groups are separated by 2.5rem; the
onboarding entry sits 2rem below the band. Header height is 3.5rem at all widths.

Responsive behavior is layout collapse, not restyling. Below 30rem the index date
leaves its fixed 8.5rem column and wraps under the title; below the framework's
`md` the sidebar becomes a menu and the contents rail becomes a collapsed bar.
Two structural corrections belong to this system: the splash layout renders no
sidebar, so its theme control is forced visible on phones (otherwise the entry
page of a light/dark wiki would have no switch), and a table-of-contents list
with a single entry is removed entirely rather than spending a column or a
full-width mobile bar on one word.

### Named Rules

**The One Sheet Rule.** Header, sidebar, and content share one ground. Regions
are separated by a 1px hairline and nothing else — no tinted panel, no fill, no
shadow, no rounded container around a region.

**The Own Box Scrolls Rule.** Wide content scrolls inside its own box so the page
never scrolls horizontally. Tables are `display: block; overflow-x: auto` on the
table element itself, and images and diagrams are capped at `max-width: 100%`.
The UX suite asserts the table pair and the absence of page overflow directly.

## Elevation & Depth

This system has no shadows. There is no shadow vocabulary to document, and adding
one would break the world. Depth is expressed by exactly two devices: a 1px
hairline that divides, and a single sunken surface one step from the ground that
recesses. Where the framework ships elevation — pagination cards arrive with a
box-shadow — it is explicitly removed and replaced with a hairline box.

The one exception is the sticky header, which is translucent (`80%` ground) with
a `blur(16px)` backdrop so content passes visibly beneath it. That is a
transparency behavior for a fixed element, not an elevation effect, and it is the
only blur in the system. It is scoped to `header.header` on purpose: a bare
`.header` selector also matches the caption element inside every code frame.

### Named Rules

**The No-Shadow Rule.** Nothing in this system casts a shadow, at rest or in any
state. If a surface needs to separate, it gets a hairline; if it needs to recede,
it gets the sunken tone. A `box-shadow` in a diff is a defect.

**The Hover Is A Border Rule.** A hairline box responds to hover by moving its
border from hairline to border-strong, or to the accent for the one entry that is
a destination. It does not lift, scale, or fill.

## Shapes

The form language is rectangular and quiet. Corners are one of three values:
square (`0`) for code frame interiors, which are clipped by their parent frame;
4px for small inline objects — inline code, keyboard keys, focus-ring corners;
and 8px for boxes — code frames, the onboarding entry, the empty state, the
error block. Nothing is more rounded than 8px and nothing is a pill.

Borders are always exactly 1px and always a full box or a full edge; there are no
thick rules, no double rules, and no accent slabs. Emphasis that would elsewhere
be a colored left slab is a single hairline here: blockquotes take a 1px
inline-start rule in border-strong, and the active table-of-contents entry takes
a 1px inline-start rule in the accent, pulled back by −1px so it replaces the
rail's own hairline instead of sitting beside it.

Icons are authored inline as 16×16 SVG line drawings at 1.5 stroke width, sized
to `1em` and colored by `currentColor` so they inherit their row's tone and its
hover state. There is no icon font and no icon package.

## Components

### Corpus Index Row (signature component)

The system's defining pattern, and the reason the home page exists. Each row is a
baseline-aligned flex line: title at ink weight, an optional muted folder
qualifier, and a right-aligned date in a fixed 8.5rem column with tabular
numerals. Rows are separated by a hairline between siblings only — no border
above the first or below the last.

- **Hover:** the title takes the accent; nothing moves.
- **Focus:** 2px accent outline, 2px offset, 4px corner radius.
- **Freshness rank:** the date carries age tonally. Fresh (≤14 days) sits at ink
  strong and weight 500, recent (≤90 days) at body ink, older at muted. The step
  is tonal, never chromatic.
- **Unknown dates** stay at the same tone as a real date and are italicized; a
  lighter gray fell below the contrast floor in the light theme, and this is text
  a reader must read.

### Provenance Row

Directly under a document title: one fact and three actions. Freshness ("Updated
3 days ago") takes ink strong with a clock icon; the actions — Copy as Markdown,
View as Markdown, Open in Google Docs — stay muted, each with a 16px inline SVG.
A 1px hairline divider separates the fact from the actions. Actions are
unstyled-by-default (no background, no border, no padding) and reveal themselves
on hover with the accent plus a 1px underline at 0.2em offset. The copy control
confirms in place by swapping its own label to "Copied" in the accent, or "Copy
failed" in the framework red, resetting after 4 seconds; a visually hidden
`role="status"` announces the same outcome.

**The Ink Step Rule.** Where one statement sits beside several controls, the
statement takes ink and the controls stay muted. Without that step, one fact and
three actions read as four identical links.

### Onboarding Entry

The single card-like object in the system, and the only one: a hairline box (8px
radius, 0.875rem/1rem padding) holding an accent-colored title and a muted note.
It is pinned above the corpus groups because it is a destination rather than a
listing. It is not a template for a card grid.

### Breadcrumbs

A flat `/`-separated trail at 0.875rem, entirely at the muted tone, with the
separator generated in `::before` so it is never selected, announced, or copied.
There is no leaf segment: the title directly below is the current page. Only the
top-level folder segment links, pointing at that folder's group anchor on the
home index, because Drive folders have no pages of their own.

### Navigation (sidebar)

Framework list navigation on the page ground, divided from content by one
hairline. The current page is marked by the sunken surface plus accent text at
weight 600 — a quiet surface rather than a saturated fill, because navigation
must not be the loudest thing on a page meant for reading. Folder labels are
normalized at the point of use in `astro.config.mjs` (trailing slashes stripped),
never in the generated sidebar file, which is pipeline-owned.

### Table of Contents Rail

A 1px hairline runs the length of the list. Each link carries a transparent
inline-start border pulled back by −1px with 1rem inset; the active entry turns
that border the accent and its text accent at weight 600. This is the one place
in the rail where color appears. A single-entry rail is hidden outright.

### Code Frames

A hairline box (1px, 8px radius, `overflow: hidden`) over the sunken surface,
with the interior `pre` squared off so the frame's own corners do the clipping. A
titled frame gets a hairline under its caption and no fill or blur of its own.
Inline code takes the inline-code background, a hairline border, and a 4px radius.

### Pagination

Two quiet hairline boxes (0.75rem/1rem padding), shadow removed, direction
caption at 0.875rem muted and title at body size in ink. Border moves to
border-strong on hover.

### Named Rules

**The Accent Focus Rule.** Every interactive element takes the same focus
treatment: a 2px solid accent outline at 2–3px offset with a 4px corner radius.
No custom rings, no glow, no removal.

**The Server Date Rule.** Dates are rendered absolute in the markup and upgraded
to relative phrasing ("3 days ago") plus a freshness tone by a `<relative-date>`
custom element in the browser, with the absolute value preserved in `title`.
Built bytes never depend on the clock, because the pipeline's determinism rules
require identical output for identical input; without JavaScript the absolute
date remains.

## Do's and Don'ts

### Do:

- **Do** build new surfaces by overriding Starlight's `--sl-*` custom properties
  plus the local `--kb-*` roles (`--kb-surface-sunken`, `--kb-border-strong`,
  `--kb-nav-bg-translucent`, `--kb-index-width`). This system is a token override
  of the framework, not a parallel stylesheet.
- **Do** define both theme values whenever a new token is added, and measure each
  against its own ground before shipping it.
- **Do** separate regions with a single 1px hairline and recess surfaces with the
  sunken tone.
- **Do** spend the accent on location, hover, and focus only.
- **Do** scope component CSS inside `@layer starlight.components` (or
  `starlight.core` for component overrides) so cascade order stays predictable.
- **Do** author icons inline as 16×16 line SVGs at 1.5 stroke, sized `1em` and
  colored `currentColor`.
- **Do** report freshness from `googleModifiedTime` — when a person edited the
  source — never from `syncedAt`, which changes on every pipeline run and would
  report the entire corpus as fresh after any sync.
- **Do** normalize generated data at the point of use. Generated content under
  `src/content/docs/_generated/` and `src/generated/` is pipeline-owned; the
  sidebar label fix lives in `astro.config.mjs` for exactly this reason.

### Don't:

- **Don't** add a `box-shadow` anywhere, in any state. There is no elevation in
  this system.
- **Don't** introduce a second hue, a tinted neutral, or a chromatic status color
  beyond the framework's red error tone. Emphasis is tonal.
- **Don't** reuse `#ed6b2d` as text on the light ground — it measures 3.04:1 and
  fails the accessibility gate. Only the mark carries the unmodified brand color.
- **Don't** enlarge headings on wide viewports or add a display/hero scale above
  2.1875rem. This is a reference document, not a landing page.
- **Don't** rebuild the home page as a grid of section cards. The index shows the
  corpus; a card grid only claims it exists.
- **Don't** fill the current navigation item with a saturated accent background.
- **Don't** use uppercase tracked type as a decorative kicker or eyebrow; it is a
  group heading style only.
- **Don't** wrap a wide table in an extra scroll container — the overflow lives on
  the table element and the UX suite asserts that exact pair.
- **Don't** load fonts, icons, or scripts from a third-party origin. Everything is
  self-hosted; the site sits behind Cloudflare Access.
- **Don't** hand-edit generated files to fix a presentation problem.
