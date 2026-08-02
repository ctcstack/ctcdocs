# ADR-004: Cloudflare Access protects the complete wiki

- Status: Accepted
- Date: 2026-07-30
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The wiki and Pagefind index contain internal documentation, while the MVP must
not implement a custom user system.

## Decision

Serve the static output through Cloudflare Workers Static Assets. Cloudflare
Access protects the complete `docs.example.com` hostname, including HTML,
assets, Pagefind, robots, and error pages.

The employee allow policy accepts only the configured CTCStack Google Workspace
identity provider and grants access to every identity in that Workspace
organization. A separate wiki group is not used because the product owner
confirmed that every employee should have access.

The policy uses `Login Methods = CTCStack Google Workspace`, while the
application rejects all other identity providers. `Everyone`, One-time PIN,
and a single email suffix are not equivalent replacements.

Automated smoke tests use a separate Access service token through a `Service
Auth` policy. The Worker configuration disables both the production
`workers.dev` route and version Preview URLs.

## Consequences

### Positive

- One authorization boundary exists outside the application.
- The application has no runtime backend or user database.
- New employees receive access through the Google Workspace identity lifecycle
  without separate wiki group management.
- Black-box negative and positive smoke tests can prove the boundary before and
  after deployment.

### Negative

- Every alternate hostname is a potential authorization bypass.
- Automated E2E checks require a separately rotated service token.
- Excluding one employee requires disabling that Workspace identity or a later
  policy change.
- A custom-domain transfer between Workers must retain Access protection
  throughout the cutover.

## Follow-up

- Verify `workers_dev=false` and `preview_urls=false` after every deployment.
- Confirm no public Pages project, legacy Worker route, or alternate custom
  hostname exists before deploying real content.
- Practice the version rollback workflow after the first production deployment.
