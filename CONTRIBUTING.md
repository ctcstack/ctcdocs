# Contributing to CTCDocs

Thank you for looking. This is a small project with a strong bias toward being
boring in production, so most of what follows is about keeping it that way.

## Getting set up

```bash
pnpm install
pnpm --filter ctcdocs-fixture-project exec playwright install --with-deps chromium
pnpm verify
```

You need Node 22 (see `.node-version`) and pnpm 11. The browser is a separate
step because the gate ends in browser checks and nothing else installs it.

`pnpm verify` is the gate CI runs: formatting, lint, types, unit and fixture
tests, the fixture project's build, its browser and search checks, and a
Wrangler dry run. It builds the packages first — compiled output is not
committed, so a fresh clone has none.

## What belongs here

This is a narrow tool, and the constraints in [AGENTS.md](AGENTS.md) are
decisions rather than gaps: no database, no server-side rendering, no semantic
search, no editing surface, no second content source. A change that widens the
scope needs an ADR arguing the case before it needs an implementation.

Read [AGENTS.md](AGENTS.md) before a substantial change. It is written for
coding agents, and it is the shortest accurate statement of the invariants this
repository is held to.

## The shape of a change

- **One reviewable vertical slice at a time.** A converter fix, its fixture, and
  its test belong in one commit; three unrelated fixes do not.
- **Fixture first for conversion changes.** Add or extend a sanitized fixture
  under `packages/sync/fixtures/` before changing how Markdown is produced, so
  the diff shows what the output becomes.
- **Explain a new dependency.** Production dependencies are added rarely and
  with a reason in the pull request.
- **Verify external APIs.** Google, Cloudflare and Astro all move. Check the
  current documentation rather than copying a snippet from ours.

## Things that will be sent back

- Real documentation content in a fixture, a test snapshot, an issue, or a
  Playwright trace. Fixtures are synthetic (see [SECURITY.md](SECURITY.md)).
- A project name, hostname, Worker name, document slug, or Google file
  identifier written into source, tests, workflows or documentation. Everything
  that identifies a deployment comes from that deployment's
  `site.config.json`, and the platform must work for a project it has never
  heard of.
- Making the generated-path allowlist configurable. It is a security control.
- Nondeterministic output: unordered iteration, timestamps inside content
  hashes, anything whose bytes change for identical input.
- A workflow that grants more permission than its job needs, exposes a secret
  to a pull-request trigger, or references a third-party action by tag instead
  of a full commit SHA.

## Commits and pull requests

Conventional Commit-style subjects (`fix(sync): …`). Explain in the body what
changed and why; the diff already says how. Update the ADRs in `docs/ADR/` when
a change alters architecture, and the runbooks when it alters operations.

## Architecture decisions

`docs/ADR/` holds the decision record. If your change contradicts one, add an
ADR that supersedes it rather than quietly diverging.

## Releasing

All three packages share a version and are released together; what changed is
in [CHANGELOG.md](CHANGELOG.md).

A release is a `v*` tag whose name matches the version in all three manifests
and has a section in the changelog. The workflow refuses a tag that disagrees
with either, runs the gate, and publishes core, then sync, then the site
package — the order their dependencies need — through npm trusted publishing,
so no publish credential is stored anywhere.

Compiled output is built by `prepack` and exists only in the published tarball.
