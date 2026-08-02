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
  screen-reader-accessible, and private behind Cloudflare Access.
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
site.config.json          product name, hostnames, Worker name, sync markers
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

The packages are not published to npm yet. Until they are, a project installs
them from this repository, pinned to a commit:

```json
{
  "dependencies": {
    "@ctcstack/ctcdocs": "github:ctcstack/ctcdocs#<commit>&path:/packages/astro",
    "@ctcstack/ctcdocs-sync": "github:ctcstack/ctcdocs#<commit>&path:/packages/sync"
  },
  "pnpm": {
    "overrides": {
      "@ctcstack/ctcdocs-core": "github:ctcstack/ctcdocs#<commit>&path:/packages/core"
    }
  }
}
```

pnpm 9 or newer is required for the `path:` fragment. `astro`,
`@astrojs/starlight` and `@playwright/test` are peer dependencies, so the
project owns their versions.

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

## Repository status

The packages are consumed from Git while the npm scope is being set up, so the
compiled output of `packages/core`, `packages/sync` and `packages/astro` is
committed: an install then runs no build script, which is what keeps automated
version bumps green. CI rebuilds and fails if a committed artifact is stale.
Publishing to npm removes the arrangement.
