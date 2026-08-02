# ADR-008: Automatic development promotion is optional

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: the mandatory development promotion in ADR-007

## Context

The development environment is not currently used as a routine release gate.
Automatically deploying every production candidate to development consumes
runner time and Cloudflare API operations without supporting an active product
workflow.

The standalone development workflow remains useful for explicit validation and
future release processes.

## Decision

Skip automatic development promotion by default. Keep the standalone
development workflow manually dispatchable from `main`.

The repository Actions variable
`ENABLE_DEVELOPMENT_DEPLOYMENT=true` restores automatic development deployment
and its protected smoke test as a blocking production gate.

## Consequences

### Positive

- Routine production releases avoid an unused deployment stage.
- Development can still be exercised manually.
- The original promotion gate can be restored without a code change.

### Negative

- Production candidates are not automatically exercised in development by
  default.
- Operators must remember to enable the variable when development becomes part
  of the release process again.

### Follow-up

- Re-enable automatic promotion when an active release task depends on the
  development environment.
