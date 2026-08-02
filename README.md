# CTCDocs

A documentation platform for teams whose writers live in Google Docs and whose
readers should not.

CTCDocs synchronizes a Google Shared Drive one way into standard Markdown,
commits the result to a private repository, and builds it into a static
Astro/Starlight site deployed as Cloudflare Workers Static Assets behind
Cloudflare Access. There is no database, no server-side rendering, and no
editing surface: the Google Doc is the source of truth, and everything the site
serves is a file somebody can read in a diff.

> **Status: 0.x.** The packages are used in production by their first
> deployment, and the API is still allowed to move between minor versions.

## Why it exists

Documentation platforms usually ask a company to choose between the editor
people actually use and the site people can actually read. This one refuses the
choice:

- **Writers keep Google Docs.** Comments, suggestions, sharing, and the editing
  habits a team already has.
- **Readers get a static site.** Fast, searchable with Pagefind, keyboard- and
  screen-reader-accessible, and either private behind Cloudflare Access or open
  to the world — one setting, and the checks follow it.
- **Machines get plain Markdown.** Every page is also served as `.md`, and the
  corpus ships with a generated index, so an internal agent can read the
  documentation without scraping HTML.
- **Operators get a boring system.** Generated output is committed, so a bad
  sync is a revert. Two runs over unchanged input produce zero diff.

Starlight on its own, GitBook, and Markdown-in-Git all assume the people who
write the documentation will work in the documentation tool. CTCDocs assumes
they will not. Confluence and Notion answer the same refusal with an editor and
a database; this answers it with committed Markdown you can diff, review and
revert. Publishing a Doc to the web gives you a page; this gives you a corpus
with search, stable URLs, and one setting deciding who may read it.

## Before you start

CTCDocs is narrow on purpose. If any of these is not true for you, it is the
wrong tool, and it is cheaper to find that out now:

- Documents live in a Google **Shared Drive**. A personal Drive has no
  equivalent of the drive-wide read-only identity this depends on.
- The site deploys to **Cloudflare** as Workers Static Assets, on a zone you
  control.
- Automation runs in **GitHub Actions**. Synchronization and deployment ship as
  reusable workflows.
- Synchronization authenticates with a **short-lived OAuth token**, normally
  from GitHub OIDC through Google Workload Identity Federation. The pipeline
  never reads a service-account key file, by design.
- **Node 22.12 or newer** (below 23) and **pnpm 11**.

Standing a project up involves a Google Workspace administrator and a
Cloudflare account. Neither is fast to arrange, so start them early.

## Packages

| Package                  | What it is                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@ctcstack/ctcdocs`      | The site: an Astro configuration preset, Starlight component overrides, routes, styles, and the browser test suite a project runs.    |
| `@ctcstack/ctcdocs-sync` | The pipeline: Google Drive → Markdown, plus the `ctcdocs-sync` command line.                                                          |
| `@ctcstack/ctcdocs-core` | Configuration schema, project layout, and the generated-path allowlist. A transitive dependency; projects do not install it directly. |

They live in `packages/astro`, `packages/sync` and `packages/core`, share one
version, and are released together.

## What a project looks like

A CTCDocs project is a private repository that holds its own identity, brand and
content, and nothing else:

```text
site.config.json          product name, hostnames, visibility, Worker, markers
astro.config.mjs          ~10 lines: a call to the preset
wrangler.jsonc            deployment target
public/favicon.svg        the brand mark
src/styles/brand.css      the brand accents
src/content/docs/         hand-authored pages
src/content/docs/_generated/   written by the pipeline
data/                     manifest, index, last report — written by the pipeline
```

Its whole Astro configuration is the preset call:

```js
import { defineConfig } from 'astro/config';
import { ctcdocsConfig } from '@ctcstack/ctcdocs/config';

import siteConfig from './site.config.json' with { type: 'json' };
import { generatedRedirects } from './src/generated/redirects.ts';
import { generatedSidebar } from './src/generated/sidebar.ts';

export default defineConfig(
  ctcdocsConfig({
    siteConfig,
    sidebar: generatedSidebar,
    redirects: generatedRedirects,
  }),
);
```

## Installing

```bash
pnpm add @ctcstack/ctcdocs @ctcstack/ctcdocs-sync
pnpm add astro @astrojs/starlight sharp @playwright/test
```

`astro`, `@astrojs/starlight`, `sharp` and `@playwright/test` are peer
dependencies, so the project owns their versions. `@ctcstack/ctcdocs-core`
arrives as a transitive dependency of both.

Every release is published from CI with provenance, so `npm audit signatures`
can tell you which commit and which workflow run produced what you installed.

## Documentation

In the order a new deployment needs them:

| Document                                                 | What it answers                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Configuration](docs/CONFIGURATION.md)                   | Every key of `site.config.json`, and what is deliberately not in it            |
| [Google Workspace setup](docs/GOOGLE_WORKSPACE_SETUP.md) | The read-only identity the pipeline synchronizes with                          |
| [Cloudflare setup](docs/CLOUDFLARE_SETUP.md)             | Worker, custom domains, and the Access application in front of them            |
| [Deployment](docs/DEPLOYMENT.md)                         | Environments, secrets, and the workflows that publish a commit                 |
| [Operations](docs/OPERATIONS.md)                         | Running it: scheduled sync, rollback, and what to do when something fails      |
| [Design](docs/DESIGN.md)                                 | The reader interface, and the accessibility budget any visual change must meet |
| [Decisions](docs/ADR/README.md)                          | Why it is built this way, and what was rejected                                |

## Development

```bash
pnpm install
pnpm --filter ctcdocs-fixture-project exec playwright install --with-deps chromium
pnpm verify
```

`fixtures/project/` is a complete CTCDocs project with a synthetic corpus. It is
what the platform's own CI builds and tests, and the best place to see how the
pieces fit together. More in
[LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

Real documentation content never enters this repository — not in fixtures, not
in test snapshots, not in issue reports. See [SECURITY.md](SECURITY.md).

Contributions, and how a release is cut: [CONTRIBUTING.md](CONTRIBUTING.md).
What changed between versions: [CHANGELOG.md](CHANGELOG.md).

## License

[Apache-2.0](LICENSE).
