# Architecture Decision Records

ADRs record significant technical decisions and deviations from the approved
specification.

## Statuses

```text
Proposed
Accepted
Superseded
Deprecated
Rejected
```

## Rules

- One ADR covers one decision.
- An ADR describes context and consequences, not the discussion history.
- An accepted ADR is not rewritten retroactively. A new ADR supersedes it.
- Changes to the manifest schema, authentication strategy, hosting topology, or
  converter architecture always require an ADR.

## Current records

- ADR-001: Astro + Starlight.
- ADR-002: generated Markdown is stored in Git.
- ADR-003: inventory reconciliation in GitHub Actions.
- ADR-004: Cloudflare Access.
- ADR-005: stable slug strategy.
- ADR-006: manifest v2 and redirects.
- ADR-007: separate Cloudflare development and production environments.
- ADR-008: optional automatic development promotion. Superseded by ADR-015.
- ADR-009: twice-daily scheduled synchronization.
- ADR-010: static Markdown web projection.
- ADR-011: documentation design language for the reader interface.
- ADR-012: project identity in a single configuration layer.
- ADR-013: editorial navigation order from Drive names.
- ADR-014: an address for every Drive folder.
- ADR-015: the platform in its own repository and packages.
- ADR-016: who may read a deployment is configuration.
- ADR-017: the full index becomes a page.

Create a new ADR by copying `000-template.md`.
