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

## Packages

| Package                  | What it is                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@ctcstack/ctcdocs`      | The site: an Astro configuration preset, Starlight component overrides, routes, styles, and the browser test suite a project runs.    |
| `@ctcstack/ctcdocs-sync` | The pipeline: Google Drive → Markdown, plus the `ctcdocs-sync` command line.                                                          |
| `@ctcstack/ctcdocs-core` | Configuration schema, project layout, and the generated-path allowlist. A transitive dependency; projects do not install it directly. |

The repository directories are `packages/astro`, `packages/sync` and
`packages/core`. The whole repository is CTCDocs, so the directories do not
repeat the name.

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

## Development

```bash
pnpm install
pnpm verify
```

`fixtures/project/` is a complete CTCDocs project with a synthetic corpus. It is
what the platform's own CI builds and tests, and the best place to see how the
pieces fit together.

Real documentation content never enters this repository — not in fixtures, not
in test snapshots, not in issue reports. See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).

## Releasing

All three packages share a version and are released together; what changed is in
[CHANGELOG.md](CHANGELOG.md).

A release is a `v*` tag whose name matches the version in all three manifests.
The workflow refuses a tag that disagrees with them, runs the gate above, and
publishes core, then sync, then the site package — the order their dependencies
need — through npm trusted publishing, so no publish credential is stored
anywhere.

Compiled output is built by `prepack` and exists only in the published tarball.
