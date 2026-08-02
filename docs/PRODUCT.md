# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

All four audiences are confirmed as primary; none is a secondary afterthought.

- **Any CTCStack employee looking something up mid-task.** Arrives with a specific
  question — a regulation, an instruction, a product description — finds the
  answer, and leaves. Optimizes for landing, scanning, and exiting quickly.
- **New hires during onboarding.** Their first weeks are sequential reading about
  the company, its products, and its processes. Structure and a legible reading
  path matter more here than search speed.
- **Management and process owners.** CEO and department heads consulting
  operating instructions, governance, and RACI documents as a management
  reference.
- **AI agents, as an equal class of consumer.** Machine reading via
  `data/docs-index.json` and raw Markdown (the `/<slug>/index.md` projection
  route) carries the same weight as human reading and must be preserved in
  design decisions, not treated as a byproduct.

Everyone admitted through Cloudflare Access sees the same wiki. There are no
roles, no per-section permissions, and no per-document ACL.

## Product Purpose

A protected, searchable publishing layer over Google Docs. Editors keep working
in Google Docs in a designated Shared Drive — that remains the human editorial
source of truth. The wiki is a strictly read-only, one-way projection
(Drive → Markdown → static site) so company knowledge is findable in one place
without moving anyone off the tools they already write in.

Success means an employee finds a trusted answer without asking a colleague, and
an AI agent can consume the same corpus as clean standard Markdown.

## Positioning

The wiki does not compete with a general wiki product; it exists because the
company's writing already happens in Google Docs and will keep happening there.
The distinguishing mechanism is the one-way deterministic sync: the same source
document always produces the same bytes of Markdown, a full sync run twice
against unchanged input produces zero diff, and a failed sync leaves the last
known-good output untouched. Content stability, not editing features, is the
product.

## Operating Context

- Access is gated by Cloudflare Access with Google Workspace as the only
  identity provider. There is no public alternate hostname, and the site carries
  `noindex, nofollow, noarchive` plus a blanket `Disallow: /` as defense in
  depth.
- Navigation structure is derived from the Drive folder hierarchy, currently
  `General`, `Company/`, `Products/`, and `Instructions/`. Moving a document
  between folders changes the sidebar but keeps the URL stable.
- Body content is genuinely multilingual — Russian, Ukrainian, English, and
  Spanish documents coexist. The interface language is English and there are no
  locale routes.
- Documents carry sync provenance shown to the reader: last synced time, source
  modified time, a link to view the raw Markdown, and a link to open the original
  Google Doc.

## Capabilities and Constraints

- Read-only wiki. No editing, commenting, or write-back to Drive from the site.
- Static output only: Astro + Starlight + Pagefind deployed as Cloudflare Workers
  Static Assets. No database, no SSR, no semantic or vector search, no LLM
  content transformation, no custom authentication.
- Generated Markdown, assets, sidebar, redirects, and the AI index are owned by
  the sync pipeline and must never be hand-edited.
- Accessibility, keyboard search, and mobile behavior are enforced by an
  automated gate (`pnpm test:ux`), not left to review judgment. See
  _Accessibility & Inclusion_.
- The corpus currently in the repository is mostly test fixtures and
  `Copy of Copy of` documents with thin bodies. It is not representative
  production content and must not be used as evidence of how real pages read.
- **Constraint lifted (2026-07-31):** the specification's rule against custom
  design work before the sync pipeline was ready no longer applies. Phases −1
  through 6 are delivered, and the product owner has confirmed that visual work
  on the wiki is now in scope. The security, conversion-correctness, and
  determinism priorities above it are unchanged. The written specification
  (§25.6) and the priority list in `AGENTS.md` still record the old rule and
  need updating.

## Brand Commitments

- The product name is written **CTCStack**, one word. Preferred but not
  critical.
- The brand mark is the orange bird at `.tmp/ctcstack-design/logo-ctc.svg` — a
  single path in `#ED6B2D` on a 32×30 viewBox. This is the real mark.
- The current `public/favicon.svg` (a multicolor gradient stacked-layer
  logotype) is a **temporary placeholder** and is to be replaced by the orange
  mark. Nothing should be derived from the placeholder's colors.
- Logo lockups exist for both themes as presentation boards, not as clean
  shippable assets: `.tmp/ctcstack-design/stsstack-logo-light.svg` (background
  `#F4F4F4`, wordmark `#0F1B24`, mark `#ED6B2D`) and
  `stsstack-logo-dark.svg` (background `#1C1C1C`, wordmark white, mark
  `#ED6B2D`). Both include a board background, a `#C4C4C4` border, and a drop
  shadow that are presentation framing, not part of the logo.
- **Open item:** `.tmp/` is git-ignored, so none of these files are tracked. The
  final artwork has to be extracted into a committed path before it can ship.
- **Binding reference, volunteered by the product owner:** the styling of the
  Cloudflare developer documentation
  (`https://developers.cloudflare.com/workers/framework-guides/web-apps/react/`)
  is to be the basis for both the light and the dark theme of this wiki.
- There is no brand guide. Typography, the neutral palette, logo clear-space and
  monochrome rules, and tone of voice are undecided and must not be invented as
  if they were company standards.

## Evidence on Hand

- Brand artwork: the three SVGs in `.tmp/ctcstack-design/` described above.
- Real content: `src/pages/index.astro` and
  `src/content/docs/about-wiki.md` are hand-authored. Everything
  under `_generated/` is pipeline output.
- **Absent, and not to be fabricated:** brand guide, typeface licenses or font
  files, official color values beyond `#ED6B2D`, `#0F1B24`, `#F4F4F4`, and
  `#1C1C1C` as read from the artwork, screenshots, testimonials, usage metrics,
  and any representative production document set.

## Product Principles

1. **Protection before presentation.** No change may make internal content or
   credentials reachable without Cloudflare Access.
2. **The projection is faithful and deterministic.** Identical input produces
   identical bytes; a failure preserves the last known-good output.
3. **Machines are readers too.** Anything that improves the page for a person
   must not degrade the raw Markdown or the AI index for an agent.
4. **Findability is the job.** The employee looking something up mid-task is the
   default case; navigation and search win over expression when they conflict.
5. **Content is multilingual by design.** Layout and type must hold Cyrillic,
   Latin, and mixed-script text without special-casing.

## Accessibility & Inclusion

Accessibility is an enforced gate, not an aspiration. `tests/ux/wiki.spec.ts`
asserts zero Axe violations on the home page in both light and dark themes, zero
violations on a 390×844 mobile document page with the menu open, working
keyboard-only search (focus → Enter → dialog → focused input → Escape), no
horizontal page overflow, and horizontally scrollable tables. Any visual change
must keep all of it passing.
