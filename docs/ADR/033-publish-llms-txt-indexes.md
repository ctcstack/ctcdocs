# ADR-033: Publish llms.txt indexes and describe pages for agents

- Status: Proposed; superseded in part by
  [ADR-039](039-open-a-folder-only-to-the-google-groups-its-rule-names.md), under which
  an index describes only documents of its own access class
- Date: 2026-09-29
- Owners: CTCDocs maintainers
- Supersedes: ADR-010 in part: the protected `llms.txt` index it deferred until
  the Markdown projection had production usage is published now

## Context

ADR-010 gives every synchronized document a Markdown version at its address
plus `index.md`, and names it on the page. An agent that is handed one page can
read it. An agent that is handed the site cannot find the rest without crawling
the HTML: the document index the sync writes, `data/docs-index.json`, stays in
the project repository and is not served, and Pagefind answers queries only in
a browser.

`llms.txt` is the convention agents and their tools look for at a site's root:
a Markdown file with a title, a one-line summary, and lists of links under
`##` headings. Documentation frameworks now ship one by default, together with
a `<link rel="alternate">` to each page's Markdown and schema.org JSON-LD in
the head. ADR-010 deferred the index until the per-page contract had usage,
but the product record treats agents as an equal reader, and an index is what
makes the contract usable.

The corpus has an editorial order that exists only in the generated sidebar:
the sync derives it from Drive names (ADR-013). Folder pages exist only when a
project turns them on (ADR-014).

## Decision

**The site serves `/llms.txt`**, generated at build time from the content
collection and the generated sidebar. It lists every document that has a
Markdown version, once, in the order the sidebar shows it: one `##` heading per
folder that holds documents, named by its whole trail (`Reference / Guides`),
and one line per document with its title, the address of its Markdown version
and its description. A PDF says so in its link text. A document the sidebar
does not list is filed under `Other documents` at the end rather than dropped.
Links are root-relative, like the links inside the Markdown projection, so one
build serves every environment.

**A top-level folder with a page of its own also gets `/<its page>/llms.txt`**,
listing only that folder, and the site index links to it first under the
folder's heading. A folder's page is found by the folder's name, and Drive lets
two folders in one parent share a name, so when two top-level folders resolve
to one page only the first gets its index; both stay in the site index. Deeper folders do not: at the current corpus sizes the site
index is small, and one index per folder would multiply files without saving
an agent a request.

**There is no `llms-full.txt`,** the whole corpus in one file, for now. The
indexes name the same content the projection already serves; a single bundle
of every document is a separate decision about how agents should consume the
corpus.

**Every page's head points at the index,** with
`<link rel="alternate" type="text/plain" href="/llms.txt">`, and a document's
head also points at its Markdown version, with
`<link rel="alternate" type="text/markdown">`. **Three kinds of page describe
themselves in JSON-LD:** the home page as a `WebSite`, a document as a
`WebPage` with its edit date, its source and its Markdown version as an
`encoding`, and a folder page as a `CollectionPage`. The platform's own routes
carry none.

**The indexes are content and are protected as content.** They sit behind the
same identity boundary as the pages. A project's `_headers` carries rules for
`/llms.txt` and `/*/llms.txt`, which never overlap, with the same cache and
robots policy as `/*.md` and `Content-Type: text/plain; charset=utf-8`, because
a static build discards the type an endpoint sets. `ctcdocs-sync validate`
requires both rules on a private deployment, and the access smoke test requires
an anonymous request for `/llms.txt` to be denied and an admitted one to return
it with that charset, listing the document whose Markdown it also checks. It
reads the index up to 25 MiB, the largest file Workers Static Assets serves,
because the index grows with the corpus.

## Consequences

### Positive

- An agent given the site's address finds every document and its Markdown
  version in one request, in the order readers see them.
- An agent working in one area of the corpus can read only that area's index.
- A page fetched as HTML names its Markdown version and the index without the
  interface being parsed.
- The output is a pure function of the corpus: the same input builds the same
  bytes.

### Negative

- A project must add two `_headers` rules when it upgrades; validation fails on
  a private deployment until it does. A public deployment is not required to,
  but without the charset its non-ASCII titles are decoded wrongly.
- Titles and descriptions of every document are now in one file. That changes
  nothing the boundary protects, since each page already serves them, but a
  leak of that one file would show the whole corpus's shape.
- The indexes depend on the generated sidebar reaching the routes, through a
  virtual module the preset serves. A project that replaces the preset's
  sidebar entirely keeps the order of the sidebar it passes. A project that
  replaces the preset's integrations loses the routes, while every page's head
  still links to `/llms.txt`.
- The routes and their data module read generated types, so the platform
  package cannot type-check them; the fixture project's `typecheck` does,
  through `tsconfig.platform.json`.
- JSON-LD is written for machines that already read HTML; search engines are
  kept out of private deployments, so its audience is agents alone there.

### Follow-up

- Measure whether agents use the indexes before adding `llms-full.txt` or
  per-folder indexes below the top level.
- Revisit an `Accept: text/markdown` response, as ADR-010 left open, if real
  agent clients cannot follow the alternate links.
