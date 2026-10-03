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
packages/astro/    @ctcstack/ctcdocs        preset, components, routes, styles, browser suite, Workers
fixtures/project/  a complete synthetic project, built and tested by CI
docs/              architecture decisions, configuration reference, runbooks
.github/workflows/ this repository's CI, plus reusable workflows projects call
```

`packages/core` and `packages/sync` compile to `dist` because Node executes
them. `packages/astro` ships its `.astro`, `.ts` and `.css` sources unbuilt, the
way Starlight does, because the consuming project's Astro build compiles them;
its `worker/` is bundled by the project's Wrangler. The Worker code uses
web-standard APIs only, with Cloudflare confined to its two entry files and
the MCP server's OAuth adapter (`worker/agents/oauth.ts`), so a deployment can
move to another host without rewriting its gate. The authorization step
(`worker/agents/authorize.ts`) is written against that OAuth library's
helpers and imports its types, never its code: moving host replaces the
library, the adapter and that step, and nothing else.

## Product invariants

- Editorial source of truth: Google Docs, and PDF files, in a Shared Drive.
  Technical source of truth: the generated Markdown, assets, manifest, sidebar
  and index committed to the project repository.
- Synchronization is one way: Drive → Markdown → static site.
- The target is Astro + Starlight + Pagefind on Cloudflare Workers Static
  Assets. A deployment is private or public, declared per environment by
  `visibility` in the project configuration; the checks follow the declaration
  rather than assuming one. See ADR-016.
- A private deployment is served through the platform's Worker, which signs
  readers in with Google and decides every request against the build's access
  map (ADR-038). Google is the only identity provider: the Worker keeps no
  passwords, profiles or roles of its own, and group membership is read from
  Google into a snapshot (ADR-040).
- Access per folder follows ADR-039: rules name Google groups by Drive folder,
  a folder without a rule is closed to all but administrators, and a move in
  Drive never gives a document readers it did not have until a rule on its new
  place is confirmed.
- Do not add server-side rendering, a database, or an LLM content
  transformation. The Worker decides who may read a file; it serves pages and
  files as built and never changes one. Its state is the directory snapshot,
  the groups' pins and the machine keys in KV and, when the MCP server is on
  (ADR-041), the OAuth library's own KV namespace and a copy of each
  document's Markdown in R2, which AI Search indexes, beside a marker of the
  build it holds. Neither the bucket nor the index decides access: the access
  map does, on every request.
- Do not broaden scope to Sheets, Slides, comments, suggestions, webhooks, or
  bidirectional editing.

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
- Every Google identity is read-only: no create, edit, move, delete, or
  permission change. The synchronization identity reads one Drive and has no
  key; the directory reader reads groups and users through a read-only admin
  role, and its key lives only in the directory Worker's secret.
- Do not log document bodies, tokens, private keys, service account JSON,
  sensitive URLs, or a reader's address, ID or group membership.
- The Worker fails closed. A missing secret, snapshot or map entry admits no
  one; a stale snapshot admits members only to what every member reads.
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
build, its validation, the denial suite against its build, its browser and
Pagefind checks, and `wrangler deploy --dry-run` for both Workers.

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

- a change that could publish a private deployment's content without its
  identity boundary, or make a public one unreachable;
- a change to the Worker, the access map, the class computation or the search
  split without a test that would fail if it admitted the wrong reader;
- a built file the access map does not place, or text that reaches a wider
  class than the document it came from;
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
