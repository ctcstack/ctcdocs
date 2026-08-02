# ADR-011: Adopt a documentation design language for the reader interface

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Specification section 25.6 limited MVP branding to the CTCStack logo, the
product name, an accent color taken from current branding, and the default
Starlight light and dark themes. It deferred any substantial custom design
until the synchronization pipeline was ready. `AGENTS.md` ranks visual
customization last of seven priorities.

Phases −1 through 6 are delivered. The pipeline, search, accessibility gate,
and production deployment are in place, so the condition the deferral waited
on has been met.

The reader interface is currently the Starlight default with a slate and blue
token override that is not derived from any CTCStack asset, and the committed
`favicon.svg` is an unrelated placeholder. The interface therefore carries no
company identity at all.

Three constraints bind any replacement. The corpus is expected to reach roughly
twenty to eighty documents, so navigation must read well at that size rather
than at the scale of a large public documentation site. Document bodies are
multilingual, mixing Cyrillic and Latin script within single pages. The UX
suite asserts zero accessibility violations on the home page in both themes and
on a narrow mobile document page, so every color pair is a gate, not a
preference.

## Decision

The section 25.6 constraint is lifted. Visual work on the reader interface is
in scope. Priorities one through five in `AGENTS.md` are unchanged and continue
to outrank presentation; only the standing prohibition is withdrawn.

The wiki adopts the design language of the Cloudflare developer documentation
as its visual authority for both themes. What is adopted is the working system,
not a resemblance: a neutral gray ramp at zero chroma so that a single
chromatic accent carries meaning wherever it appears, flat surfaces separated
by one-pixel hairlines rather than fills and shadows, a three-column reading
shell, generous prose leading, and headings set semibold with negative
tracking.

The accent is the CTCStack orange from the company mark. It is expressed as two
theme-specific values because a single value cannot clear the accessibility
gate. Measured against the adopted grounds, `#ED6B2D` reaches 5.91:1 on the
dark background and is used unchanged there, but only 3.04:1 on the light
background, which fails WCAG AA for text. The light theme therefore uses a
darkened tone of the same hue at or below `oklch(56% .166 42)`. The mark itself
keeps the unmodified brand color, because it is artwork rather than text.

Typography is Inter for prose and JetBrains Mono for code, self-hosted as woff2
subsets covering Latin and Cyrillic. Fonts are served from the deployment
itself; no external font CDN is introduced, because the site sits behind
Cloudflare Access and must not depend on a third-party origin.

Three structural changes accompany the theme. Source metadata moves from the
document footer to directly below the document title, where a reader needs it
before reading rather than after, and gains a clipboard action alongside the
existing Markdown and Google Docs links. The document page gains breadcrumbs
and an active-section marker in the table of contents. The home page becomes a
provenance-led index of the whole corpus ordered by source modification time,
replacing the section card grid; at the expected corpus size the index and the
recency view are the same artifact.

The placeholder `favicon.svg` is replaced by the CTCStack mark.

This decision does not change the synchronization pipeline, the generated-path
ownership rules, the Markdown projection routes, the crawler-denial headers,
the content collection schema, or the Cloudflare Access boundary.

## Consequences

### Positive

- The interface carries CTCStack identity instead of a framework default and an
  unrelated placeholder mark.
- Source modification time becomes visible on the home page, so a reader can
  judge whether an instruction is current without opening it.
- The clipboard action on every document serves AI agents, which the product
  record treats as an equal class of consumer.
- Self-hosted fonts keep the deployment free of third-party origins, consistent
  with the leakage priority.
- Accent contrast is measured against the actual grounds rather than inherited
  from the reference, so the accessibility gate is designed for rather than
  discovered at CI time.

### Negative

- Font files add bytes to every deployment and require their SIL OFL license
  files to be committed alongside them.
- The accent is no longer a single token. Two theme-specific values must be
  kept in step, and any future accent change is two edits, not one.
- The reference's own light theme fails AA on text links. The wiki diverges
  there deliberately, so the two will not match exactly in light mode, and
  anyone comparing them will see the difference as a defect unless this record
  is read.
- Component overrides increase coupling to Starlight internals and raise the
  cost of future Starlight upgrades.
- The home page depends on `googleModifiedTime` being present and correct in
  generated frontmatter. Documents lacking it, including manually authored
  pages, need a defined fallback rather than an empty column.

### Follow-up

- Extract clean light and dark logo assets from the supplied presentation
  boards, which currently carry a board background, border, and drop shadow,
  and commit them; the working copies are in an untracked directory.
- Update specification section 25.6 and the `AGENTS.md` priority list to
  reference this record rather than the withdrawn prohibition.
- Font payload, measured after the first production build: a typical English
  page transfers 86.6 KB (Inter Latin 47.1 KB, JetBrains Mono Latin 39.5 KB).
  A Russian or Ukrainian document adds 18.3 KB of Inter Cyrillic, and a
  document without code blocks never requests the monospace family at all.
- Verify the UX suite passes in both themes, including the narrow mobile
  document page, before merge.
- Record the resulting design system in `DESIGN.md` after the build, from the
  built interface rather than from intention.
