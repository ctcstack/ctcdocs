# ADR-035: Open a folder with its page when it has no landing document

- Status: Proposed
- Date: 2026-09-29
- Owners: CTCDocs maintainers
- Supersedes: ADR-014 in part: the folder's page is in the sidebar when the
  folder has no landing document

## Context

ADR-014 gave every Drive folder a page, listing its subfolders and documents,
and kept that page out of the sidebar: a Starlight group has a label and
items, and making the label a link means overriding the sidebar. So the page is
reached only by its URL, a folder card or a breadcrumb, and when it is open the
sidebar highlights nothing and previous and next skip it.

Some folders already open with a page of their own: a document titled like a
landing page, such as Overview, which the sidebar lists first (ADR-013). Others
have none, and there a reader browsing the sidebar never meets the one page
that says what the folder holds. Documentation frameworks solve this without a
clickable label by listing the folder's page as the first item of its group.
Doing that everywhere would give a folder with an Overview document two entries
named alike.

## Decision

**A folder's page is the first item of its sidebar group when the folder
holds no document with a landing title.** The sync lists the page first when
the folder has a page (`navigation.sectionIndexPages`) and holds no document
whose title, without its order number, is one of
`navigation.landingDocumentTitles`, in any case. A numbered "02 - Overview"
counts wherever its number places it, because the sidebar shows it as
"Overview": the rule is about names, so a group never lists two entries with
one name. For the same reason the page stays out beside a subfolder labeled
like it.

**The item takes the first landing title as its label**, "Overview" by
default, since it stands in for the landing document the folder lacks. The
label names only what the page is, so the item also carries the folder's
name, as `aria-label` "Reference: Overview": screen readers read it, and the
previous and next links, which Starlight titles with sidebar labels, show it
instead of a bare "Overview".

**Nothing else changes.** A folder with a landing document keeps it where
its name and number place it, and its page stays out of the sidebar. An empty folder stays out of
the sidebar, as it has no group. The group's label is still text, so the
sidebar is not overridden. The page stays out of search.

## Consequences

### Positive

- Every non-empty folder opens, in the sidebar, with either its landing
  document or its page listing what it holds.
- A folder's page is highlighted in the sidebar when open, and has previous
  and next links in the reading order.
- A group never lists two entries with one name, and the previous and next
  links say which folder a page belongs to.

### Negative

- Whether the page is in the sidebar depends on a document's title: renaming
  "Overview" to something else puts the page in the sidebar on the next sync,
  and back. A numbered landing document does not necessarily open its group,
  and the page still stays out.
- The label is the project's first landing title in every group, so a project
  whose titles are not in the interface's language shows that title.
- Previous and next now pass through folder pages, which carry no text of
  their own, only the listing.
- A folder whose landing document is a PDF also counts as opened, though the
  PDF's page is a file rather than an introduction.

### Follow-up

- If readers still miss folder pages in folders that have an Overview
  document, link the page from that document's header rather than adding a
  second sidebar entry.
