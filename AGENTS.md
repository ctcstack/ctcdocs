# CTCDocs — repository instructions

This file is the single set of instructions for coding agents. `CLAUDE.md` is a
symbolic link to it; edit `AGENTS.md` only.

CTCDocs is the platform, not a deployment. It is published as three packages and
consumed by private project repositories that hold their own configuration,
brand and content. Read [README.md](README.md) for the shape of a project and
[CONTRIBUTING.md](CONTRIBUTING.md) for what gets a change sent back.

## Language

- Write all repository content in English: documentation, comments,
  identifiers, commit messages, error messages, issue and pull request prose.
- Reply to a maintainer in the language they wrote in.

## The one rule that shapes everything

**Nothing in this repository may name a deployment.** Not a product name, a
hostname, a Worker name, a document slug, a Google file identifier, a Drive
label, or an ownership marker — in source, tests, fixtures, workflows or
documentation. Everything that identifies a deployment is read from that
project's `site.config.json` through `@ctcstack/ctcdocs-core`, or drawn from the
generated corpus at run time.

This is why the packages exist, and it is the property that lets the repository
be public while the deployments stay private.

## Layout

```text
packages/core/     @ctcstack/ctcdocs-core   configuration, layout, allowlist
packages/sync/     @ctcstack/ctcdocs-sync   Google Drive → Markdown, CLI
packages/astro/    @ctcstack/ctcdocs        preset, components, routes, styles, browser suite
fixtures/project/  a complete synthetic project, built and tested by CI
docs/              architecture decisions, configuration reference, runbooks
.github/workflows/ this repository's CI, plus reusable workflows projects call
```

`packages/core` and `packages/sync` compile to `dist` because Node executes
them. `packages/astro` ships its `.astro`, `.ts` and `.css` sources unbuilt, the
way Starlight does, because the consuming project's Astro build compiles them.

## Product invariants

- Editorial source of truth: Google Docs in a Shared Drive. Technical source of
  truth: the generated Markdown, assets, manifest, sidebar and index committed
  to the project repository.
- Synchronization is one way: Drive → Markdown → static site.
- The target is Astro + Starlight + Pagefind on Cloudflare Workers Static Assets
  behind Cloudflare Access.
- Do not add a database, server-side rendering, semantic search, vector storage,
  an LLM content transformation, or an authentication system of our own.
- Do not broaden scope to Sheets, Slides, comments, suggestions, per-section
  access control, webhooks, or bidirectional editing.

## Priorities

In descending order:

1. No leakage of internal content or credentials.
2. Correct and complete content conversion.
3. Deterministic, idempotent output.
4. Recoverability and simple operations.
5. AI-friendly standard Markdown.
6. Navigation and search usability.
7. Visual customization.

Ranking is not exclusion: interface work is in scope, and the accessibility gate
in the browser suite is a hard constraint on every visual change.

## Working method

- One reviewable vertical slice at a time.
- Create or extend a sanitized fixture before changing conversion behavior.
- Prefer small explicit modules and standard library APIs over framework
  abstractions.
- Verify current external API signatures against official documentation rather
  than trusting a remembered snippet.
- Keep production dependencies minimal and justify any addition.
- Never point a destructive or mutating test at a real Drive.

## Security rules

- The generated-path allowlist in `packages/core` is a compile-time constant.
  Never make it configurable.
- The Google identity is read-only: no create, edit, move, delete, or permission
  change.
- Do not log document bodies, tokens, private keys, service account JSON, or
  sensitive URLs.
- Sanitize HTML and SVG, validate URL schemes, and defend archive extraction
  against traversal, excessive file counts and excessive extracted size.
- Workflows declare explicit minimal `permissions`, pin third-party actions to
  full commit SHAs, and never expose deployment or sync credentials to a
  pull-request trigger.
- Generated output is written atomically; a failed run leaves the last
  known-good output untouched.

## Testing and verification

The canonical gate is:

```bash
pnpm verify
```

It covers formatting, lint, types, unit and fixture tests, the fixture project's
build, its browser and Pagefind checks, and `wrangler deploy --dry-run`.

Also useful, and run in CI:

```bash
actionlint
zizmor .github/workflows
gitleaks git --no-banner .
gitleaks dir --no-banner .
```

- Unit-test pure transformation logic; use golden fixtures for Markdown
  conversion; use property-based tests for slug allocation, path handling,
  deterministic serialization and hostile archive or URL input.
- A full sync run twice over unchanged input must produce zero diff.
- The fixture corpus is regenerated in CI and must match byte for byte.

## Review rules

Flag, and do not merge:

- a change that could publish content without Cloudflare Access protection;
- a workflow exposing credentials to a pull request or taking permissions
  broader than its job needs;
- a deployment value written into source, tests, workflows or documentation
  instead of being read from the project configuration;
- non-atomic writes to generated output, or writes outside the allowlist;
- parsing of Markdown, links, HTML, SVG or archive paths with regular
  expressions where a real parser is available;
- nondeterministic ordering, timestamps in content hashes, or output whose bytes
  change for identical input;
- real deployment content in a fixture, snapshot, trace or issue.
