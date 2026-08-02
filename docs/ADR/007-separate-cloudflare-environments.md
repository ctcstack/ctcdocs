# ADR-007: Separate Cloudflare development and production environments

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The initial synthetic staging validation and the planned production deployment
used the same hostname. That topology cannot support an explicit development
release, a development smoke gate, and a controlled promotion to production
without route transfers or shared deployment history.

Cloudflare Workers named environments create distinct immutable Workers while
allowing the same reviewed configuration and build process to be used for both
targets.

## Decision

Use two Wrangler named environments:

```text
development → example-docs-development → docs-dev.example.com
production  → example-docs-production  → docs.example.com
```

Each hostname has its own Cloudflare Access application, Access service token,
Cloudflare deploy token, GitHub deployment and smoke environments, and
deployment history. Both disable `workers.dev` and version preview URLs.

The development workflow is manual and accepts only the exact `main` ref. The
production workflow remains triggered by pushes to `main`, calls the
development workflow first, and proceeds only after the protected development
smoke test succeeds.

The root Wrangler Worker is not a deployment target. Every Wrangler deploy,
dry-run, and rollback command must pass an explicit `--env development` or
`--env production`.

## Consequences

### Positive

- Development and production failures, credentials, and rollback histories are
  isolated.
- The exact production candidate is exercised behind Access before promotion.
- Accidental `workers.dev` and preview URLs remain disabled for both targets.
- Production still deploys automatically after a successful generated-content
  commit on `main`.

### Negative

- Cloudflare and GitHub require two additional protected environments and a
  second hostname.
- The first development deployment needs a one-time synthetic bootstrap because
  the preflight cannot reach a hostname before its custom-domain binding
  exists.
- The production Worker name changes from the root `ctc-wiki` name to
  `example-docs-production`.

## Follow-up

- Create and validate the development Access application before the bootstrap.
- Keep development and production credentials separate.
- Remove obsolete bootstrap Worker bindings only after both named environments
  pass their protected smoke tests.
- Verify rollback against `example-docs-production`.
