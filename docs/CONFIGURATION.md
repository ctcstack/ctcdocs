# Configuration

Everything that identifies one deployment of this platform lives in
`site.config.json`. No source file, test, or workflow carries a project
name of its own; they read this file. The rationale is recorded in
[ADR-012](ADR/012-project-configuration-layer.md).

## The configuration file

```json
{
  "brand": {
    "name": "Example Corp",
    "siteTitle": "Example [DOCS]",
    "siteDescription": "Internal Example documentation",
    "faviconPath": "/favicon.svg"
  },
  "deployment": {
    "workerName": "example-docs",
    "environments": {
      "development": { "url": "https://docs-dev.example.com" },
      "production": { "url": "https://docs.example.com" }
    }
  },
  "home": {
    "lede": "Every document here is published from Google Docs in the Example Shared Drive and is read-only. Each entry shows when its source was last edited."
  },
  "navigation": {
    "landingDocumentTitles": ["Overview", "README", "About"],
    "sectionIndexPages": true
  },
  "sync": {
    "generatedBy": "CTCDOCS SYNC",
    "commitBotName": "ctcdocs-sync[bot]",
    "defaultLocale": "en"
  }
}
```

| Value                              | Where it shows up                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `brand.name`                       | Reserved for prose that names the organization rather than the site.                                                        |
| `brand.siteTitle`                  | Browser tab, header wordmark, home page heading, and both browser test suites.                                              |
| `brand.siteDescription`            | Site-wide meta description and the home page's own description.                                                             |
| `brand.faviconPath`                | The `<link rel="icon">` target and the asset the Access smoke test probes.                                                  |
| `deployment.workerName`            | The Worker `wrangler.jsonc` must declare; environments deploy as `<name>-<environment>`.                                    |
| `deployment.environments.*`        | Canonical site URL, Wrangler custom domains, deployment summaries, smoke-test defaults.                                     |
| `home.lede`                        | The paragraph under the home page heading, in full: where documents come from and what a reader may do with them.           |
| `navigation.landingDocumentTitles` | Titles that open the folder they sit in, most preferred first. Also picks the description the home page shows for a folder. |
| `navigation.sectionIndexPages`     | Whether each folder gets a generated page listing its contents at `/<folder-slug>/`.                                        |
| `sync.generatedBy`                 | The ownership marker stamped into every generated Markdown and TypeScript file.                                             |
| `sync.commitBotName`               | Git author the sync workflow commits generated output as.                                                                   |
| `sync.defaultLocale`               | Fallback locale for documents whose language cannot be determined.                                                          |

The file is validated when it is imported, so a mistake fails the build rather
than reaching a deployment:

- both environment URLs must be bare HTTPS origins — no credentials, path, or
  query — and must differ from each other;
- `deployment.workerName` must be a name Cloudflare accepts;
- `sync.generatedBy` must not contain `--` or `<`, which would terminate the
  HTML comment it is embedded in;
- `navigation.landingDocumentTitles` must be a non-empty list of distinct
  titles; two entries differing only in case are rejected rather than merged,
  because the precedence between them would otherwise depend on which one a
  folder happens to contain;
- `navigation.sectionIndexPages` must be present and boolean;
- no required value may be empty.

### Changing `sync.generatedBy`

This one is not cosmetic. The marker is written into every generated file, so
changing it rewrites the whole generated corpus. Do it deliberately, in its own
commit, by running a full sync (`pnpm sync:full`) rather than by editing
generated files.

## What is not in the configuration file

**Secrets and per-environment addresses** are environment variables. Copy
`.env.example` and fill it in. `SYNC_SITE_BASE_URL`, `SYNC_DEFAULT_LOCALE`, and
`CTCDOCS_BASE_URL` fall back to the configuration and only need a value when a run
should target something else, such as the protected test corpus.

**Brand artwork and color** are files, not values:

- `public/favicon.svg` — the mark, also shown beside the wordmark in
  the header.
- `src/styles/brand.css` — the accent triad for each theme.

They are files because the accent carries measured contrast ratios. `pnpm test:ux`
runs axe against both themes and fails on a contrast regression, so measure a
replacement accent against the two grounds named in `brand.css` before
committing it.

**Editorial pages** — `src/content/docs/*.md` — are written for the
project that owns the wiki. `about-wiki.md` describes the platform in general
terms and needs no edit; anything else added there is project content.

**The deployment target itself** — `wrangler.jsonc` — is
hand-written, because Wrangler reads its own configuration file and cannot be
handed values from elsewhere. `ctcdocs-sync validate` fails when its Worker
name or either custom domain disagrees with `site.config.json`, so the
two cannot drift apart silently.

## Standing the platform up for another project

1. Edit `site.config.json`.
2. Update `wrangler.jsonc` to the same Worker name and hostnames.
   `ctcdocs-sync validate` tells you if you missed one.
3. Replace `public/favicon.svg` and the accent triads in
   `src/styles/brand.css`.
4. Point the sync at the new Shared Drive with `GOOGLE_DRIVE_ID` and
   `GOOGLE_ROOT_FOLDER_ID`, following
   [GOOGLE_WORKSPACE_SETUP.md](GOOGLE_WORKSPACE_SETUP.md).
5. Create the Cloudflare Access application and custom domains, following
   [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md).
6. Set the repository and environment secrets and variables listed in
   [DEPLOYMENT.md](DEPLOYMENT.md).
7. Run a first sync and the local gate:

```bash
pnpm sync:full && pnpm verify
```

Renaming the workspace packages is optional — they are private and never
published — but see the convention below if you do.

## Package naming

npm scopes are one level deep, so a scope shared by several products has to
carry the product in the package name. Everything in this repository belongs to
the `docs` product inside the `@ctcstack` scope:

| Package                  | Directory         | What it is                                       |
| ------------------------ | ----------------- | ------------------------------------------------ |
| `@ctcstack/docs`         | repository root   | The workspace itself. Not a publishable unit.    |
| `@ctcstack/ctcdocs-core` | `config/`         | Project configuration and its validating loader. |
| `@ctcstack/ctcdocs-core` | `packages/shared` | Constants shared by the pipeline and the site.   |
| `@ctcstack/ctcdocs-sync` | `packages/sync`   | Google Drive → Markdown pipeline and its CLI.    |
| `@ctcstack/ctcdocs`      | `apps/wiki`       | The Astro + Starlight reader interface.          |

Directories do not repeat the `docs-` prefix. The whole repository is the
`docs` product, so `packages/sync` is unambiguous and `packages/docs-sync`
would only be longer.

Every package is `private: true`. This is a repository you fork and configure,
not a set of libraries you install: the deployable artifact is the site, the
Worker configuration, and the workflows together. If `@ctcstack/ctcdocs-sync` is
ever published on its own, it is the only package here with an API worth
committing to, and its CLI is already named `ctcstack-docs-sync` so it cannot
collide with another organization's `docs-sync` on a global install.

## Why the checks stay honest

The browser suites take their sample documents from `data/docs-index.json` and
the generated asset tree rather than naming a document, so they assert the
shape of a corpus and pass against any of them. A test that hardcodes a slug,
a hostname, or a product name is a bug in this repository; use
`siteConfiguration` from `@ctcstack/ctcdocs-core` and the helpers in
`tests/support/corpus-fixtures.ts` instead.
