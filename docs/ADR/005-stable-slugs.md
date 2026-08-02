# ADR-005: Stable slugs are independent of the current Drive hierarchy

- Status: Accepted
- Date: 2026-07-30
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Renaming or moving a document must update navigation without breaking published
URLs or internal links.

## Decision

Allocate a readable stable slug when a document is first discovered and store
it in the manifest by Google file ID. Bind the physical Markdown filename to the
file ID. Build the sidebar from the current Drive hierarchy independently of the
URL.

## Consequences

### Positive

- Renames and moves do not break links.
- Collision resolution runs once and is deterministic.

### Negative

- The URL does not automatically follow a new title.
- An explicit URL change requires a redirect and a separate operation.

### Follow-up

- Cover slug allocation, collision, preservation, and reseeding with fixtures.
