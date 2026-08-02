# @ctcstack/ctcdocs

The site layer of [CTCDocs](https://github.com/ctcstack/ctcdocs): an
Astro/Starlight configuration preset, the Starlight component overrides, the
routes a documentation deployment needs, the interface stylesheet, and the
browser suite a project runs against its own corpus.

CTCDocs synchronizes a Google Shared Drive one way into standard Markdown,
commits the result, and builds it into a static site deployed as Cloudflare
Workers Static Assets — private behind an identity boundary or open to the
world, declared per environment.

## Install

```bash
pnpm add @ctcstack/ctcdocs @ctcstack/ctcdocs-sync
pnpm add astro @astrojs/starlight sharp @playwright/test
```

`astro`, `@astrojs/starlight`, `sharp` and `@playwright/test` are peer
dependencies: the project owns their versions.

## Use

A project's whole Astro configuration is a call to the preset:

```js
import { ctcdocsConfig } from '@ctcstack/ctcdocs/config';
import { defineConfig } from 'astro/config';

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

The content collection is a re-export:

```ts
// src/content.config.ts
export { collections } from '@ctcstack/ctcdocs/content';
```

And the accessibility suite is a factory call, so it stays owned by the
platform and runs against whatever corpus the project has:

```ts
// playwright.ux.config.ts
import { defineUxConfig } from '@ctcstack/ctcdocs/playwright';

export default defineUxConfig();
```

## Entrypoints

| Entrypoint                     | What it is                                               |
| ------------------------------ | -------------------------------------------------------- |
| `@ctcstack/ctcdocs/config`     | `ctcdocsConfig(options)` → an Astro configuration object |
| `@ctcstack/ctcdocs/content`    | the `docs` collection definition                         |
| `@ctcstack/ctcdocs/styles.css` | the interface stylesheet                                 |
| `@ctcstack/ctcdocs/playwright` | `defineUxConfig()` and `defineAccessConfig()`            |
| `@ctcstack/ctcdocs/eslint`     | the shared ESLint configuration                          |
| `@ctcstack/ctcdocs/prettier`   | the shared Prettier configuration                        |

Two binaries come with it: `ctcdocs-verify-search`, which proves the built
Pagefind index finds the documents the corpus contains, and
`ctcdocs-access-smoke`, which proves a deployment is reachable exactly by the
audience it declares.

## Documentation

[Configuration reference](https://github.com/ctcstack/ctcdocs/blob/main/docs/CONFIGURATION.md)
· [Architecture decisions](https://github.com/ctcstack/ctcdocs/tree/main/docs/ADR)
· [Security policy](https://github.com/ctcstack/ctcdocs/blob/main/SECURITY.md)

Apache-2.0. `0.x`: the API may still move between minor versions.
