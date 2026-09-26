# ADR-021: Addresses may follow Drive names

- Status: Proposed
- Date: 2026-09-26
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-005 gives a document its address once, from its path on first discovery,
and keeps it through every later rename and move. ADR-014 does the same for a
folder. The address changes only through `--reseed-slug`, one document at a
time, and ADR-006 leaves a redirect behind so the old address still works.

That is the right rule for a corpus people link to. It is the wrong one for a
corpus still being arranged. While editors move documents between folders and
rename folders every day, addresses drift from the structure a reader sees. A
document filed under `Sales` keeps an address under `Marketing` because that
is where it started. A title corrected after its first sync, such as the stray
alphabet ADR-020 now stops, keeps its wrong address too.

Following names with a permanent redirect for every move would keep every old
link working. At that rate of change, it would also accumulate hundreds of
redirects within weeks. Each one holds its address forever, so a later
document named the same way would get a suffixed address. Most of those
redirects would protect addresses nobody ever shared.

What an old address protects is narrower than it looks. Links between
documents are stored by ID and resolved when the site builds (ADR-022), so
they never go stale. A permanent link copied from a page survives any rename.
What is left is an address someone copied from the browser's address bar.

Two defects in the redirect record also matter once addresses move:

- Redirects exist only for documents. A folder's address cannot move without
  breaking its section page's links.
- A redirect is never removed. When the item it points at leaves the corpus,
  it points at nothing, and output validation rejects every sync after it.

## Decision

**A project chooses whether addresses follow names.** `navigation.addresses`
in `site.config.json` is `stable` or `follow-names`, and defaults to `stable`,
which is ADR-005 unchanged. A project turns `follow-names` on while its
structure settles, and switches to `stable` once people share addresses. The
addresses then stay where they are.

**Under `follow-names`, an address is what the item's current path yields.**
Every sync over the whole corpus re-derives each folder and document address
by the rules a new item gets. Order prefixes are stripped (ADR-013), so
renumbering moves nothing. A sync targeted at one file, with `--file` or
`--reseed-slug`, keeps every address where it is: it cannot tell a rename from
a collision elsewhere.

**Nothing an item was called before holds a claim on an address.** Addresses
are allocated in one pass. Items whose derived address is unchanged keep it.
The platform's routes are reserved. Items whose derived address changed are
placed next, folders first, then by address and ID. New folders and then new
documents come last. An address an item has just left is free for any other
in the same run, so two documents can swap titles cleanly. A taken address
yields the collision suffix ADR-005 defines. That suffix is derived from the
item's own ID, so an item that already carries it keeps it.

**Each item keeps one earlier address.** When a folder or document moves, the
address it left becomes a redirect to its new one. The item gives up the
redirect it had before. A link copied from the address bar therefore survives
one rename, not two. A redirect whose address a live item now takes is
dropped: the item named after an address owns it. Folders get redirects as
documents do, and a redirect may record a folder's Drive ID as its target.

**Redirects leave with their target**, whichever mode is configured. When a
folder or document leaves the corpus, the redirects that point at it are
removed in the same run, and their addresses are free again.

**A missing address searches for itself.** The platform replaces Starlight's
404 page with one that searches the site for the words of the address that
was requested. It tries the whole path, then the last segment, then each of
its words, and lists the first results. A renamed page is usually found by the
name it had. Nothing is stored for this.

## Consequences

### Positive

- While a corpus is arranged, its addresses track the structure readers see,
  with no reseed per document and no suffix left over from a name an item no
  longer has.
- Redirects never outnumber published items, and an address freed by a
  rename is free for the next item named that way.
- A title corrected after its first sync gets a correct address.
- A deleted item no longer leaves a redirect that fails every later sync.
- A stale address lands on a page that usually offers the right document
  first.

### Negative

- An address copied from the browser stops working at the item's second
  rename, or at once if another item takes it. A reader then lands on the
  404 search. People who need a lasting link have to copy the permanent link
  (ADR-022).
- An old address taken by another item opens that item, not the one it once
  named. It is the one the address's words describe, but it is not what the
  link was shared for.
- A document linked by a pasted address rather than a Google Docs link fails
  the sync once that address is gone, as any broken internal link does. The
  sync converts every address it can attribute into a permanent link when it
  exports the document.
- Starlight's 404 route is disabled. A future Starlight change to its 404 page
  does not reach the site.

### Follow-up

- Tell editors to share permanent links while `follow-names` is on.
- Switch to `stable` once the structure settles.
