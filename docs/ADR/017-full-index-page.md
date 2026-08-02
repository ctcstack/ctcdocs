# ADR-017: The full index becomes a page

- Status: Accepted
- Date: 2026-08-02
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-011 gave the home page a provenance-led index of the whole corpus and
recorded the reasoning for having no separate browse page: at twenty to eighty
documents the index and the recency view are the same artifact, so one page
could be both.

Two things have happened since. Folders gained pages of their own (ADR-014), so
the home page is no longer the only place a reader browses; and deployments
have grown past the size at which "everything, on the page you land on" reads as
an entrance rather than a wall. A deployment now reasonably wants the home page
to open on search, folders and recent changes, and to leave the complete list to
somebody who asks for it.

Making the index a home-page block that can be switched off is not enough on its
own, because the index is also an address. A folder card and a breadcrumb
segment both point at a folder's heading inside it whenever that folder has no
page of its own. If the index existed only while a setting was on, those links
would resolve on one deployment and dangle on another, and the setting would be
refusing combinations rather than describing a choice.

## Decision

**The full index is published at its own address, `/documents/`, on every
deployment.** It is an injected platform route, like the home page, so no
project carries the file.

`home.corpusIndex` decides only what the home page does about it: `true`, the
default, keeps a copy of the index as the page's last block, and `false`
replaces that block with a link to the page. Nothing about the index's
availability follows from the setting.

Folder anchors address that page — `/documents/#<folder>` — rather than the home
page's copy of it, so a folder heading has one address whatever a project
configures.

`documents` becomes a reserved slug. Slug allocation seeds it the way it seeds
folder slugs (ADR-014), so a Drive folder or document named "Documents" is
allocated a suffixed address instead. An address the corpus claimed before this
route existed is left where it is — it is a published URL — and validation
reports it, because a document silently shadowed by a route is worse than a
build that says so.

## Consequences

### Positive

- A deployment can keep its home page an entrance without losing the complete
  list, and without the two decisions being coupled.
- A folder heading has one address, independent of configuration.
- The reserved slug closes a collision that already existed in principle for
  every injected route, with the mechanism the pipeline already uses.
- The page carries `data-pagefind-ignore`, so listing every title does not put
  it in front of every search result.

### Negative

- One more page in the corpus namespace, and one more address the platform owns
  rather than the project.
- A deployment whose corpus already publishes `/documents/` fails validation
  until the source is renamed in Drive. It is a loud failure for a case that
  produced a silent one.
- Where the home page keeps the index, a folder card now leaves the page
  instead of scrolling within it. The destination is identical in content, and
  one behavior for every configuration was judged worth the scroll.

### Follow-up

- Projects that pass their own `sidebarPrefix` link the page themselves; the
  platform default links it.
