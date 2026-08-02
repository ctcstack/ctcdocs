# ADR-010: Publish a static Markdown web projection

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Generated Markdown in the private Git repository is the technical source of
truth for the wiki and repository-aware AI agents. Employees and HTTP-based
agents also need a direct, protected Markdown representation of an individual
wiki page without GitHub or Google API access.

The wiki already has stable document slugs, deterministic generated Markdown,
local validated assets, and a hostname-wide Cloudflare Access boundary.

## Decision

Astro statically prerenders each generated Google document at two sibling
routes:

```text
/<stable-slug>/
/<stable-slug>/index.md
```

The Markdown route is a deterministic projection of the content collection
entry, not a conversion of rendered HTML. It contains selected source metadata,
an explicit level-one heading, and the normalized document body. Internal wiki
links point to the target Markdown route. Original generated images are
available under `/assets/generated/<google-file-id>/<asset>` so relative image
references remain usable.

The reader interface exposes `View as Markdown` next to `Open in Google Docs`.
The feature does not add clipboard access, content negotiation, a runtime Worker
script, storage, or a separate authorization system.

Cloudflare Access protects the HTML, Markdown, and source-image routes through
the same hostname-wide application. Static response rules use private,
short-lived browser caching and crawler-denial headers for Markdown and source
images.

## Consequences

### Positive

- Humans and HTTP-based agents receive clean Markdown at a stable URL.
- Published Markdown is derived from the same normalized source as the HTML.
- The wiki remains a static Workers Static Assets deployment.
- No GitHub token, Google credential, runtime database, or content-conversion
  service is needed.
- Access smoke tests can verify the new content surface before and after deploy.

### Negative

- Original images are present twice in the deployment: optimized HTML assets
  and stable source assets for Markdown.
- The published projection is intentionally not byte-identical to the
  repository file because repository-only frontmatter and the generated-file
  ownership marker are omitted.
- Clients that want Markdown must request the explicit `index.md` URL; the HTML
  route does not negotiate on the `Accept` header.

## Follow-up

- Consider a protected `llms.txt` index only after the per-page contract has
  production usage evidence.
- Consider `Accept: text/markdown` only if real agent clients cannot use
  explicit `.md` URLs.
