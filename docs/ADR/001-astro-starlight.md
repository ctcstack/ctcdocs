# ADR-001: Astro + Starlight for the wiki

- Status: Accepted
- Date: 2026-07-30
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The product needs a static internal wiki with Markdown, navigation, a table of
contents, typography, code highlighting, and full-text search without a custom
CMS.

## Decision

Use Astro 7 and a compatible Starlight version. Generate the site statically;
Starlight provides the documentation UI and Pagefind provides search.

## Consequences

### Positive

- Minimal custom UI code.
- Standard Markdown and fast static output.
- Built-in foundations for navigation, search, and accessibility.

### Negative

- Astro and Starlight versions must be upgraded in a controlled manner.
- Custom UI is limited to Starlight extension points.

### Follow-up

- Every Astro or Starlight upgrade must pass the full build and regression suite.
