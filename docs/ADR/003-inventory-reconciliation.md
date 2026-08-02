# ADR-003: Inventory reconciliation in GitHub Actions

- Status: Accepted
- Date: 2026-07-30
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The MVP must reliably detect additions, updates, renames, moves, and deletions
without an additional state store.

## Decision

Every sync retrieves the Shared Drive metadata inventory, builds the current
tree, and compares it with the manifest. Content is exported only when needed.
GitHub Actions performs the orchestration.

## Consequences

### Positive

- Straightforward recovery after a failure.
- Renames, moves, and deletions are detected without Changes API token state.
- No database is required.

### Negative

- Every run lists metadata for the entire corpus.
- Significant corpus growth will require optimization.

### Follow-up

- Preserve a provider interface that allows a later migration to the Changes API.
