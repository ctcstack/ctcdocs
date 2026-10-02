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
- ADR-018: a sync run scans what it commits, and a finding stops it.
- ADR-019: folders before documents, and a section page that tells them apart.
- ADR-020: a Drive name is written in one alphabet.
- ADR-021: addresses may follow Drive names.
- ADR-022: every page has a permanent short ID.
- ADR-023: a report on how documents carry their titles.
- ADR-024: a content health page that turns checks into work.
- ADR-025: name every file the site leaves out, and why.
- ADR-026: hold back a document that cannot be exported, not the corpus.
- ADR-027: publish PDF files from Drive. Supersedes ADR-020 in part.
- ADR-028: make every sync legible, grouped by what to do.
- ADR-029: say when an image has no alt text.
- ADR-030: note images cropped in Google Docs.
- ADR-031: apply the crop Google Docs makes to an image. Supersedes ADR-030 in
  part.
- ADR-032: search a missing address by its name. Supersedes ADR-021 in part.
- ADR-033: publish llms.txt indexes and describe pages for agents. Supersedes
  ADR-010 in part.
- ADR-034: check headings, summaries and links that leave the site.
- ADR-035: open a folder with its page when it has no landing document.
  Supersedes ADR-014 in part.
- ADR-036: index the home page by its title, and a folder where it has its
  address. Supersedes ADR-017 in part.
- ADR-037: rank the content health page by priority. Supersedes ADR-024 and
  ADR-028 in part, and ADR-011 in part for status colors on that page.
- ADR-038: a private deployment signs readers in itself, with Google.
  Supersedes ADR-004 once accepted, and ADR-016, ADR-010 and ADR-007 in part.
- ADR-039: open a folder only to the Google groups its rule names. Supersedes
  ADR-033, ADR-032, ADR-024 and ADR-037 in part.
- ADR-040: a Worker cron keeps a snapshot of group membership.

Create a new ADR by copying `000-template.md`.
