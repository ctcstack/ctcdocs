# ADR-036: Index the home page by its title, and a folder where it has its address

- Status: Proposed
- Date: 2026-09-30
- Owners: CTCDocs maintainers
- Supersedes: ADR-017 in part: the full index is no longer excluded from the
  search index as a whole

## Context

The search index is meant to hold documents. Two platform pages put other text
in it.

The home page was indexed in full. Everything on it below its title repeats
what a document's own page holds — folder names and descriptions, document
titles, dates — or is interface text: "Browse by folder", "Recently updated",
the block for AI agents. A search for nearly any document title returned the
home page beside the document, and the 404 page could offer the home page in
place of the page a stale address named, the failure ADR-032 records.

The full index was excluded as a whole (ADR-017), so that listing every title
did not put it in front of every search result. That also excluded the folder
headings, which are a folder's address when it has no page of its own
(ADR-014). The home page's folder cards were then the only indexed text that
named such a folder. Excluding the home page without changing the full index
would leave those folders' names unsearchable, and the 404 page, which falls
back to the folders' words for an address such as `/sales/q1/`, would find
nothing.

The check that interface text stays out of the index had meanwhile stopped
testing anything. It searched for a sentence no component rendered any more,
and a search that finds nothing passes. Searching for a label that is rendered
does not fix it on its own: a quoted Pagefind search matches stems, crosses
element boundaries and reads `alt` text, so a document that talks about the
label fails the check, and a model of what Pagefind reads is wrong in both
directions.

## Decision

**The home page is indexed by its title alone.** Everything below the title
carries `data-pagefind-ignore` as one block, so a block added to the page later
is excluded too. The configured lede goes with it.

**The full index indexes a folder's heading where the heading is the folder's
address**: a Drive folder with no page of its own. The document lists stay
excluded, and so do the heading of the group of documents at the Drive root,
which is not a folder, and the headings of folders that have a page, which
indexes their name itself. A search for such a folder's name finds its heading,
at `/documents/#<folder>`.

**An element whose text must stay out of the index is marked
`data-ctcdocs-unindexed`** as well as `data-pagefind-ignore`. The mark names
what the element is; the other attribute is what excludes it. `ctcdocs-verify-search`
reads the built pages and fails when no page marks anything, and when any marked
element inside the part Pagefind indexes is not excluded. It then has Pagefind
index one marked page as built and without its marked elements, and requires
the two to be the same, and requires what Pagefind indexes for the home page to
be exactly its title. What reaches the index is decided by Pagefind itself, not
by a model of it.

## Consequences

### Positive

- A search returns documents, and a folder where the folder has no page, rather
  than the home page beside every result.
- The 404 page's folder fallback lands on the folder's heading instead of the
  home page.
- Losing the exclusion on a single page fails the check, with that page's
  address and the element's name.
- The check depends on no label, so renaming interface text cannot turn it into
  a check that passes without testing anything.

### Negative

- The home page's lede is not searchable. It describes the site rather than a
  document, and the page is still found by the site's name.
- A project that replaces the platform's components has to keep the marks, or
  the check fails for having nothing to test.
- A search for a folder's name now also returns the full index where the folder
  has no page, ranked by Pagefind with the documents that mention it.

### Follow-up

- If projects replace components often, let the check pass with a warning when
  a build marks nothing, rather than failing.
