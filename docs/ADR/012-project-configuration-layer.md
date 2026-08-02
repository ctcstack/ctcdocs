# ADR-012: Move project identity into a single configuration layer

- Status: Accepted
- Date: 2026-08-01
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The platform was built for one deployment and named it everywhere. Renaming
the site meant editing the
Astro configuration, the home page frontmatter, two Playwright suites, the
Cloudflare Access smoke script, and a stylesheet comment — six files for one
string, with no check that they stayed in agreement.

The same held for the rest of the deployment's identity. Hostnames appeared in
`astro.config.mjs`, `wrangler.jsonc`, `playwright.config.ts`, four GitHub
workflows, and the sync environment. The Worker name was a Zod literal inside
the content validator. The ownership marker stamped into every generated file
was a string constant repeated in the sync package and again in the wiki app.
Test fixtures asserted real hostnames, a real Google file identifier, and a
real document slug, so the suite described one organization's corpus rather
than the platform's behavior.

Nothing about the pipeline is specific to one company. Standing the platform up
for another project should be a configuration change, and the checks should
keep passing when it happens.

## Decision

Project identity lives in `config/site.config.json`, a workspace package
(`@ctcstack/docs-config`) that validates the file at import time and derives the
values that follow from it: the hostname each Wrangler route must bind, and the
two ownership markers.

Everything that used to carry a project name now reads from that package.
Consumers that cannot import TypeScript — the Access smoke script and the
GitHub workflows — read the JSON directly, with `jq` in workflow steps.

Three rules follow from it.

- **No source file, test, or workflow names the project.** Values come from the
  configuration, and corpus samples come from `data/docs-index.json` and the
  generated asset tree rather than from hardcoded slugs.
- **Where a value cannot be injected, it is verified.** Wrangler reads its own
  configuration file, so `wrangler.jsonc` stays hand-written and
  `pnpm validate:content` fails when its Worker name or either custom domain
  disagrees with the configuration.
- **The home page is a route, not a collection entry.** `src/pages/index.astro`
  renders `<StarlightPage>` with frontmatter built from the configuration,
  because content-collection frontmatter cannot hold a computed title.

Brand assets are a parallel slot rather than configuration values: the accent
triads live in `apps/wiki/src/styles/brand.css` and the mark in
`apps/wiki/public/favicon.svg`. Colors carry measured contrast ratios that the
accessibility gate enforces, so they belong with the stylesheet that documents
them, not in a JSON file that invites an unmeasured edit.

Workspace packages take the `@ctcstack/docs-*` naming that follows from the
organization publishing several products under one npm scope: scopes are one
level deep, so the product has to appear in the package name. Directories keep
the short form — `packages/sync`, not `packages/docs-sync` — because the whole
repository is the `docs` product. Every package stays `private: true`; this is
a repository to fork and configure, not a set of libraries to install, since
the deployable artifact is the site, the Worker configuration, and the
workflows together.

## Consequences

### Positive

- Renaming the site or moving it to new hostnames is one edit, and the local
  gate proves the deployment configuration followed.
- Adapting the platform to another project is a configuration change plus
  credentials, not a search for every hardcoded string.
- Hostnames and Worker names are validated: an HTTPS origin without
  credentials, path, or query, and two distinct hostnames, or the build fails
  before anything deploys.
- The browser suites assert the shape of a corpus rather than its contents, so
  they survive a document being renamed and can run against any corpus.

### Negative

- One more workspace package, and one more import hop between the sync package
  and the marker it stamps.
- `sync.generatedBy` is configurable but not free to change: it is embedded in
  every generated file, so changing it rewrites the whole generated corpus in
  one commit.
- `config/site.config.json` is imported with `with { type: 'json' }`, which is
  required by the plain Node ESM loader Playwright uses and is therefore not
  optional in the TypeScript source either.

### Follow-up

- Adapting the platform to a new project is documented in
  `docs/CONFIGURATION.md`; keep it current when a new configured value is
  added.
- GitHub deployment environments take their URL from a step that reads the
  configuration, so no repository variable has to be kept in step with it.
