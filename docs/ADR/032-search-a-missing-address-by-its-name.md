# ADR-032: Search a missing address by its name

- Status: Proposed; superseded in part by
  [ADR-039](039-open-a-folder-only-to-the-google-groups-its-rule-names.md), under which
  the 404 page searches only the bundles the reader may open
- Date: 2026-09-29
- Owners: CTCDocs maintainers
- Supersedes: ADR-021 in part: the 404 page searches for the name in an
  address, not its whole path

## Context

ADR-021 replaced Starlight's 404 page with one that searches the site for the
words of the missing address. It tried the whole path first, then the last
segment, then each word of the last segment, and showed the first search that
found anything.

The index matches every word of a search, and a page does not index its folder
trail: the breadcrumb is left out of it, so a search for a folder's name does
not return every document in that folder. The home page, though, names every
folder on its cards and the latest documents in its list. For a document in a
folder, the search of the whole path found the document itself only when its
text happened to name its folders. It found the home page, and any other page
that named the same folders, and since that search had found something, the
page stopped there and offered those pages instead.

The fixture project already showed it: for two of its documents in folders, the
page offered the home page and not the document. A deployment's browser suite
found it when a document removed from its Drive made a document two folders
deep the first of its corpus, which the test then sampled. Every later sync
failed there and left the removal off the site.

## Decision

**A missing address is searched by its name**, the last segment, then by each
word of the name, longest first. The page still shows the first search that
finds anything.

**The folders are searched only when the name has no word to search for**,
such as `/sales/q1/` or `/sales/index.md`. A search that adds the folders'
words to the name finds at most the pages the name alone finds, and the page
itself only when its text happens to name its folders.

**The browser suite samples the document deepest in folders**, so every
deployment checks the address that carries the most words beyond the page's
name.

## Consequences

### Positive

- A stale address in a folder offers the page it named, as a stale address at
  the top level already did.
- The search order is a module of its own, tested without a browser.

### Negative

- Two pages with the same name in different folders are offered together, in
  the order the index ranks them. The folders cannot tell them apart while a
  page does not index its folder trail.

### Follow-up

- If same-named pages turn out to be common, rank the results whose address
  shares the missing address's folders first.
