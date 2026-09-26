# ADR-021: Addresses may follow Drive names

- Status: Proposed
- Date: 2026-09-26
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-005 gives a document its address once, from its path on first discovery,
and keeps it through every later rename and move. ADR-014 does the same for a
folder. The address changes only through `--reseed-slug`, one document at a
time, and ADR-006 leaves a redirect behind so that the old address still
works.

That is the right rule for a corpus people link to. It is the wrong one for a
corpus still being arranged. While editors move documents between folders and
rename folders every day, addresses drift from the structure a reader sees. A
document filed under `Sales` keeps an address under `Marketing` because that
is where it started. Reseeding each one by hand does not keep up. A title
corrected after its first sync, such as the stray alphabet ADR-020 now stops,
keeps its wrong address too.

Two defects in the redirect record matter as soon as addresses move often:

- Redirects exist only for documents. A folder's address cannot move without
  breaking its section page's links.
- A redirect is never removed. When the document it points at leaves the
  corpus, the redirect points at nothing, and output validation rejects every
  sync after it.

## Decision

**A project chooses whether addresses follow names.** `navigation.addresses`
in `site.config.json` is `stable` or `follow-names`, and defaults to `stable`,
which is ADR-005 unchanged. A project turns `follow-names` on while its
structure settles, and back to `stable` once people have started sharing
links. Switching in either direction is safe, because an address that moves
always leaves a redirect.

**Under `follow-names`, every sync over the whole corpus re-derives
addresses.** Each folder and document already recorded is given the address
its current Drive path yields, by the same rules as a new one. Order prefixes
are stripped (ADR-013), so renumbering still moves nothing. An item whose
derived address differs from its recorded one moves. A sync targeted at one
file, with `--file` or `--reseed-slug`, keeps every other address as it is.

**Addresses are allocated in one pass, in this order:**

1. Items whose address does not change keep it, documents before folders.
2. Every redirect source stays reserved, and so do the platform's own routes.
3. Moving items take their derived address, folders before documents, then by
   address and ID, as new items do. An address that is taken yields the
   collision suffix ADR-005 defines. That suffix is derived from the file ID,
   so an item that already carries it keeps it.
4. New folders, then new documents, as before.

**The old address always becomes a redirect.** It points at the item's new
address. Any redirect that pointed at the old address is rewritten to point at
the new one, so no chain forms. Folders now get redirects as well as
documents. A redirect records the Drive ID of its target, which may be a
folder.

**A redirect keeps its address from everyone but its own target.** A document
renamed back to an earlier title reclaims that address: the redirect is
removed and the document takes it. A different item never takes an address a
redirect holds. It receives the suffixed address instead, so an old link never
silently opens a different document.

**Redirects leave with their target.** When a folder or document leaves the
corpus, the redirects that point at it are removed in the same run, whichever
mode is configured. Old links then answer as the item's own address does: not
found. Their addresses become free again.

**Everything that lists addresses is regenerated in the run that moves them.**
That covers the sidebar, the section pages, the document index and the
redirect map. A document that links to a moved item keeps its link until it
is next exported, and output validation already accepts a link to a redirect
source. A full sync re-exports every document and removes those hops.

## Consequences

### Positive

- While a corpus is being arranged, its addresses track the structure readers
  see, with no reseed per document.
- No link breaks: every move leaves a redirect, including for folders.
- A title corrected after its first sync gets a correct address.
- A deleted item no longer leaves a redirect that fails every later sync.

### Negative

- Redirects accumulate: every move adds one, and a renamed folder adds one for
  itself and one for every document below it. ADR-006 still has no retention
  policy, so they stay until one is decided.
- A reserved redirect source forces a suffix on a different item that wants
  it, such as a new document given a moved document's old title. Its address
  is less readable than its title.
- A link inside an unchanged document reaches its target through a redirect
  until that document is re-exported.
- The Markdown projection (ADR-010) is not redirected. A reader of
  `/old/index.md` gets not found, as after a reseed today.
- Links to a deleted item stop working, as they did before. Its address may
  later be given to another item.

### Follow-up

- Cover moves, folder renames, reclaiming, collisions with redirect sources,
  switching modes, and deletion of a redirect target with tests.
- Decide a redirect retention policy in its own ADR when their number becomes
  a cost.
