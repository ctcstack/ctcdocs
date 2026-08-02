# Security policy

## Reporting a vulnerability

Report privately through GitHub's [security advisory
form](https://github.com/ctcstack/ctcdocs/security/advisories/new). Please do
not open a public issue for a vulnerability.

If that form is unavailable to you, open an issue saying only that you have a
security report and how we can reach you. Do not put the finding in it.

Include what you did, what happened, and what you expected. If the finding
involves a deployment rather than this code, report it to that deployment's
owner as well — this repository holds no content and no credentials.

We aim to acknowledge a report within three working days.

## Supported versions

The project is `0.x`. Fixes go to the latest minor version; there is no
long-term support branch yet.

## What this platform is responsible for

A CTCDocs deployment is either private behind an identity boundary or open to
the world, and it says which in its own configuration. The platform's job is not
to prefer one — it is to make the declared posture true and to fail loudly when
it is not. The properties below are enforced by code in this repository, and a
regression in any of them is a security defect rather than a bug:

- **The Google identity is read-only.** The pipeline exports documents. It must
  never create, edit, move, delete, or change permissions on anything in a
  Drive.
- **Generated output stays inside its allowlist.** The set of paths the pipeline
  may write is a compile-time constant in `@ctcstack/ctcdocs-core`, never
  configuration, and a run that would write outside it fails.
- **A deployment cannot change audience by accident.** `visibility` defaults to
  `private`, so an omission fails in the recoverable direction. Validation fails
  when the crawler rules or the response headers contradict the declared posture
  in either direction — a private site that does not deny crawlers, and a public
  one that denies them all — and when the Wrangler configuration disagrees with
  the project configuration, enables `workers.dev` or preview URLs, or binds
  more than one route to an environment.
- **The boundary is proven against the running site, not assumed.**
  `ctcdocs-access-smoke` requires a private deployment to refuse an anonymous
  request and admit a service token, and a public one to answer anonymously. It
  runs before a deployment and again afterwards, because a check that silently
  verifies nothing is worse than no check: this one has failed that way before,
  and the regression test for it is in the repository.
- **Untrusted input is parsed, not pattern-matched.** HTML and SVG are
  sanitized, URL schemes are validated, and archive extraction is defended
  against path traversal, file-count and size explosion.
- **Output is deterministic and atomic.** A failed sync or validation leaves the
  last known-good output untouched, and two runs over unchanged input produce
  zero diff.
- **Secrets stay out of pull requests.** Workflows shipped here declare minimal
  permissions, pin third-party actions to full commit SHAs, and never expose
  deployment or sync credentials to a pull-request trigger.

## What this repository must never contain

Fixtures are synthetic. No document from a real deployment — its text, its
images, its slugs, its Google file identifiers, its hostnames, or a Playwright
trace containing any of them — belongs in this repository, in an issue, or in a
pull request. If you need to demonstrate a bug with real content, describe the
shape of the content instead, or add a synthetic fixture that reproduces it.
