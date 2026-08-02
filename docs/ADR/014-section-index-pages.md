# ADR-014: Give every Drive folder an address

- Status: Accepted
- Date: 2026-08-01
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A folder is a real division of the corpus and the way readers talk about it —
and it has no address. The sidebar renders a folder as a group label, which
Starlight draws as text. The home page groups the index by folder behind an
anchor, and breadcrumbs point back at that anchor because there was nowhere
better to send them. Nothing in the published site answers "send me the link to
that section".

A folder's overview document cannot answer it either. Some folders have one and
most will not, so a link built on it would exist for part of the corpus and not
the rest — which is the same problem in a form that is harder to explain.

The constraints are the ones the pipeline already lives under. Slugs are stable
identifiers and moving one costs a redirect (ADR-005, ADR-006), so no existing
document URL should move to make room for this. Generated Markdown committed to
Git is the technical source of truth (ADR-002), so a page that exists only at
build time would be a page outside the corpus. And sibling order is already
decided (ADR-013), so a listing has an order to follow rather than one to
invent.

## Decision

**Every folder below the publication root reserves the slug its path yields,
whether or not a page is generated for it.** Reservation happens before
document allocation, and the manifest owns the result exactly as it owns
document slugs, so renaming a folder does not move its address.

Reserving unconditionally is what makes the feature switchable. If folders only
claimed slugs while the pages were enabled, a document could take `company` in
the meantime and the folder page would arrive later at a suffixed slug. Turning
the pages on or off now changes no address in either direction.

The publication root is excluded: its slug is empty, and `/` is the home page,
which is already the index of the root.

**When `navigation.sectionIndexPages` is enabled, each reserved folder gets a
generated Markdown page at its slug.** The page carries the folder's label as
its title and lists the folder's subfolders and documents in the ADR-013 order,
each with the description it publishes. A folder with no children still gets
its page, carrying a sentence that says so.

The page is generated content like every other: written atomically under
`apps/wiki/src/content/docs/_generated/`, recorded in the manifest, stamped
with the ownership marker, and never hand-edited. It declares
`sourceType: 'section-index'`, which is also what keeps it out of the home
page's corpus arithmetic — that view already selects on `sourceType`.

**Landing documents are not part of this.** An overview keeps its own slug and
appears in its section's listing like any other document. The two mechanisms
meet only in the comparator they share, which floats the overview to the top of
the listing for the same reason it floats it to the top of the sidebar group.
Folding one into the other would trade a rule anyone can state for a special
case in both.

**The page is not in the sidebar.** A Starlight sidebar group carries a label,
items, and a collapsed state — no link. Making the label clickable means
overriding the sidebar component to add a navigation control that was not
asked for. A section is reached by its URL, and later by whatever the home page
chooses to link.

**The page is not indexed and not in the AI index.** It carries no text of its
own: every line in it is a title that already ranks as its own search result,
so it is emitted with `pagefind: false`. It is absent from
`data/docs-index.json` for the matching reason — that index describes content,
and an agent reconstructs sections from the `folderPath` it already carries.

The manifest moves to schema v3, where a folder record carries its stable slug
and, when one is generated, the path of its page. Navigation settings move into
their own `navigation` section of the project configuration, taking
`landingDocumentTitles` with them.

## Consequences

### Positive

- A section has an address that can be pasted into a message, and it is the
  same shape for every folder in the corpus.
- No document URL moves, no redirect is allocated, and the switch is reversible
  without consequence.
- Breadcrumbs and the home page cards gain a real destination, so the
  `/#section-` anchor stops being the best available answer.
- An empty folder becomes visible. Today it is omitted from the sidebar and
  effectively invisible; it now has a page that says it is empty, which is a
  more useful thing for an editor to find than nothing.

### Negative

- The page has two ways in — its URL and a link someone writes. It is not in
  the sidebar, so Starlight gives it no previous or next link and no highlight
  in the tree.
- Every add, rename, move, or description change rewrites the index file of the
  folder involved, so generated-content commits get larger. The rewrite is
  honest — the section's contents really did change — but it is noise in a
  diff that used to be one file per edited document.
- The empty-section sentence is baked into generated files. Changing its
  wording rewrites every empty section page in one commit.
- Folder slugs are reserved even where no page is generated, so a document can
  be pushed to a suffixed slug by a folder whose page does not exist. This is
  the price of the switch not moving addresses, and it is paid only on a real
  name collision.
- Searching for a section by name finds its documents but not the section page.

### Follow-up

- Point breadcrumbs and the home page category cards at the section page when
  the pages are enabled, and retire the `/#section-` anchor when they do.
- Document the switch in `docs/CONFIGURATION.md` and the addressing rule in
  `docs/OPERATIONS.md`.
- Build fixtures before the generator, per the `converter-change` workflow: a
  folder with documents, an empty folder, a nested folder, and a folder whose
  slug collides with a document's.
- Confirm that a manifest written under v2 migrates without moving a document
  slug.
