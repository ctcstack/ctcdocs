# ADR-015: Extract the platform into its own repository and packages

- Status: Accepted
- Date: 2026-08-02
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The platform was built inside the repository of its first deployment. Two
problems followed from that, and both grow rather than settle.

Content churn polluted code history: the sync bot commits generated output twice
a day, and with 18 documents the tree already carried 14 MB of generated images
against a 5.2 MB pack. A platform other projects clone should not carry one
company's document images in its history.

Fixes did not propagate: a second deployment would have forked the whole
repository, so a converter fix, an accessibility fix, or a security fix in a
workflow would have to be applied by hand in every copy.

[ADR-012](012-project-configuration-layer.md) removed the first obstacle by
moving every value that identifies a deployment into one configuration file. It
deliberately kept the packages private and the repository single, and said the
deployable artifact is the site, the Worker configuration and the workflows
together. This decision revisits that last part.

## Decision

The platform becomes a public repository (`ctcstack/ctcdocs`, Apache-2.0)
publishing three packages, and every deployment becomes a private project
repository that holds only its configuration, brand and content.

- `@ctcstack/ctcdocs` — the site: Astro preset, Starlight overrides, injected
  routes, styles, and the browser suite a project runs. Shipped as source, the
  way Starlight ships, because the consuming project's Astro build compiles it.
- `@ctcstack/ctcdocs-sync` — the pipeline and the `ctcdocs-sync` command line.
  Compiled to `dist`, because Node executes it directly.
- `@ctcstack/ctcdocs-core` — configuration schema, project layout and the
  generated-path allowlist. Compiled; a transitive dependency projects never
  name.

Four choices inside that shape are worth recording.

**The distribution model is a preset factory, not a Starlight plugin.** The
project's `astro.config.mjs` calls `ctcdocsConfig()`, which returns the Astro
configuration object, and a private integration inside the package injects the
three platform routes. Handing plugin registration to Starlight would put the
markdown processor construction under Starlight's control, and that construction
is what keeps mermaid fences from reaching Expressive Code. Preserving it
verbatim removes the only fragile part of the extraction.

**The project layout is a fixed convention.** `@ctcstack/ctcdocs-core` exports
it as constants, and the generated-path allowlist derives from them. It must not
become configurable: the allowlist is a security control, and an allowlist a
project can widen is an allowlist an attacker can widen. The paths lose their
`apps/wiki/` prefix, because the Astro root becomes the project root.

**Deployment environments become an open set.** ADR-012 required exactly
`development` and `production`. A project that publishes production only is
legitimate, and so is one with a staging tier, so the schema now takes any set
of named environments that includes `production` and gives each a distinct
hostname.

**Ownership markers become functions of the configuration.** They were
module-level constants derived from a bundled JSON import. The platform no
longer owns the value: it is read from the project that installed the platform,
and two projects sharing this package must not share a marker.

## Consequences

### Positive

- One fix reaches every deployment through a version bump instead of N manual
  applications.
- The platform's history stays free of one company's content, and can be public.
- The public boundary is enforceable: no file here may name a project, a
  hostname, a document slug or a Google file identifier, which makes review a
  yes-or-no question rather than a judgment call.
- A project repository is small enough to read in one sitting: configuration,
  brand, content, four thin workflow callers.

### Negative

- `pnpm verify` no longer covers pipeline → build → accessibility → search →
  deployment configuration against a real corpus in one place. The fixture
  project in `fixtures/project/` restores that coverage with a synthetic corpus,
  and is a blocking part of the platform gate rather than an optional extra.
- A breaking change in the platform can break several projects at once. Peer
  dependencies are strict, the fixture project runs in CI, and each project
  keeps a scheduled canary job that installs the platform's `main` and runs its
  own gate.
- Releasing has friction with few consumers. The packages stay on `0.x` and are
  published from CI.

### Follow-up

- Until the npm scope exists, projects install the packages as pnpm Git
  dependencies pinned to a full commit SHA, with a `pnpm.overrides` entry for
  the transitive core package. Moving to npm is the removal of that block.
  **Done**: `0.1.0` is published, `ctcstack-docs` installs from the registry,
  and compiled output left the repository with it. The arrangement survives in
  one place by design — the projects' canary job, which installs this
  repository's unreleased `main` and therefore still packs it itself.
- Workflow references from project repositories are pinned to full commit SHAs,
  never to a tag: this repository is public and its workflows run inside private
  CI that holds deployment credentials.
