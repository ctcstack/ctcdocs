# ADR-006: Manifest v2 persists slug redirects

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-005 makes a document slug stable across ordinary rename and move events.
The explicit `--reseed-slug` operation is allowed to change that URL, but it
must preserve existing bookmarks and internal links. Redirect state must remain
deterministic across later syncs without a database or manual generated-file
edits.

## Decision

Upgrade the sync manifest from schema version 1 to schema version 2. Version 2
adds a redirect map keyed by the old stable slug. Each record stores the target
document ID, current target slug, and creation time.

The loader performs an explicit v1-to-v2 migration that preserves all v1 data
and initializes an empty redirect map. Serialization always writes v2.

`--reseed-slug <google-file-id>`:

- requires the document to exist in both the current corpus and manifest;
- derives a collision-safe slug from the current Drive path;
- reserves all current redirect sources;
- rewrites older redirects that pointed to the previous slug, avoiding chains;
- creates a permanent old-to-new redirect;
- reexports the selected document and validates the complete output.

The sync generates `apps/wiki/src/generated/redirects.ts`. Astro consumes this
map through its static `redirects` configuration, which produces static redirect
pages for this deployment topology.

## Consequences

### Positive

- Explicit URL changes preserve old links without a runtime database.
- Redirects are versioned, reviewable, and rollback-safe with the rest of the
  generated state.
- Redirect chains and slug reuse are prevented.

### Negative

- Manifest schema v1 is no longer emitted.
- Redirect entries remain until an explicit future retention policy removes
  them.
- Static deployments use Astro redirect pages rather than origin-level HTTP
  redirects.

### Follow-up

- Keep redirect validation in the canonical sync gate.
- Revisit redirect retention only through a new ADR.
