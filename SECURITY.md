# Security policy

## Reporting a vulnerability

Report privately through GitHub's [security advisory
form](https://github.com/ctcstack/ctcdocs/security/advisories/new). Please do
not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. If the finding
involves a deployment rather than this code, report it to that deployment's
owner as well — this repository holds no content and no credentials.

We aim to acknowledge a report within three working days.

## Supported versions

The project is `0.x`. Fixes go to the latest minor version; there is no
long-term support branch yet.

## What this platform is responsible for

CTCDocs deployments serve internal documentation to an authenticated audience.
The properties below are enforced by code in this repository, and a regression
in any of them is a security defect rather than a bug:

- **The Google identity is read-only.** The pipeline exports documents. It must
  never create, edit, move, delete, or change permissions on anything in a
  Drive.
- **Generated output stays inside its allowlist.** The set of paths the pipeline
  may write is a compile-time constant in `@ctcstack/ctcdocs-core`, never
  configuration, and a run that would write outside it fails.
- **Deployments cannot become public by accident.** `ctcdocs-sync validate`
  fails when the Wrangler configuration disagrees with the project
  configuration, when an environment enables `workers.dev` or preview URLs, or
  when an environment binds more than one route. `robots.txt` denies every
  crawler and every page carries `noindex, nofollow, noarchive`.
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
