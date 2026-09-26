# ADR-022: Every page has a permanent short ID

- Status: Proposed
- Date: 2026-09-26
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A page's address is readable, and under ADR-021 it can change whenever its
document is renamed or moved. Nothing a reader can copy survives that for
certain.

A link between two documents has the same weakness from the inside. The sync
writes it as the target's current address. When the target moves, every
document that links to it has to be exported again, or its link leads through
a redirect or nowhere. The generated Markdown of the linking document changes,
although nothing its author wrote did.

The Drive ID already identifies an item permanently. At some forty
characters it is too long to read or type, and it names the file in Drive
rather than the page.

## Decision

**Every published folder and document has a short ID.** It is the first six
hexadecimal characters of the SHA-256 of its Drive ID. It is lengthened by two
characters at a time while that prefix belongs to another item. Six characters
give sixteen million values, enough for a corpus of thousands with a
lengthened ID now and then. The publication root has none, because it has no
page. Folders and documents share one namespace.

**A short ID is recorded, not recomputed.** The manifest stores it on each
document and folder record the first time the item is seen. It is carried
forward from then on, so an item keeps its short ID even if a newer item's hash
prefix would have claimed it first. `shortId` is optional in the schema only
so that a manifest written before it still loads; every manifest the sync
writes carries one for every page. This is a manifest schema change without a
version bump. Earlier platforms ignore the field.

**Every page answers at `/d/<short ID>/`.** The redirect map gains a permanent
link for every document and section page, leading to its current address.
There is exactly one per page, so their number never grows beyond the
corpus. `d` becomes a platform route, reserved like `documents`. A page offers
to copy its permanent link beside its other actions. A section page, which has
no other actions, shows it alone.

**A link between documents is stored as a permanent link.** When the sync
exports a document, a link to another document of the corpus is written as
`/d/<short ID>/`. That covers a Google Docs or Drive link and a pasted address
of this site, including an earlier address a redirect answers. Fragments are
kept. The generated Markdown then never changes because its targets moved.
While the site builds, a remark step replaces each permanent link with the
address it leads to today. Readers go straight to the page, not through a
redirect. The Markdown projection (ADR-010) names the target's own Markdown,
as before. The converter version changes, so the first sync after upgrading
exports every document again and rewrites its links.

**The short ID leaves room for addresses that carry it.** An address such as
`/sales/pricing-3f2a1c/`, whose readable part may change while its ID does not,
needs routing at request time, which this static site does not have. Recording
the ID now means such an address would need no new identifier if routing is
added later.

## Consequences

### Positive

- A copied permanent link survives every rename and move, under either address
  policy.
- A document's generated Markdown depends on what its author wrote, not on
  where its targets live, so a rename re-exports only the renamed document.
- Internal links cost the reader no redirect.
- The number of redirect pages is bounded by the number of pages.

### Negative

- A permanent link is not readable: it says nothing about its page until it is
  opened.
- Following a permanent link costs one redirect page, a static page that
  refreshes to the target, not an HTTP redirect.
- The first sync after upgrading exports the whole corpus again.
- A short ID can be lengthened, so its length alone does not identify the
  format. Consumers match the pattern `^[0-9a-f]{6,64}$`.
- An item deleted from Drive frees its short ID. A later item whose hash
  happens to share the prefix could take it, and an old permanent link would
  then open that item. With six characters and a corpus of hundreds, the
  chance is small but not zero.

### Follow-up

- Decide whether readable addresses should carry the short ID once the
  platform has request-time routing.
