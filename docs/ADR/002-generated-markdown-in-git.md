# ADR-002: Store generated Markdown in Git

- Status: Accepted
- Date: 2026-07-30
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Google Docs remains the editorial source of truth, but the wiki, search, and AI
agents require stable file-based Markdown.

## Decision

The sync CLI commits generated Markdown, assets, the manifest, sidebar, and AI
index to the private Git repository. Manual changes to generated output are
forbidden.

## Consequences

### Positive

- An audit trail and straightforward rollback.
- AI agents read ordinary `.md` files without using the Google API.
- The production build is reproducible from a commit.

### Negative

- Git history retains internal text.
- The repository and Actions artifacts require strict privacy controls.

### Follow-up

- The sync bot may commit only allowlisted generated paths.
