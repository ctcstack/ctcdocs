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
      "production": {
        "url": "https://docs.example.com",
        "visibility": "private"
      }
    }
  },
  "home": {
    "lede": "Every document here is published from Google Docs in the Example Shared Drive and is read-only. Each entry shows when its source was last edited.",
    "recentLimit": 6,
    "corpusIndex": true
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

| Value                                  | Where it shows up                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `brand.name`                           | Reserved for prose that names the organization rather than the site.                                                        |
| `brand.siteTitle`                      | Browser tab, header wordmark, home page heading, and both browser test suites.                                              |
| `brand.siteDescription`                | Site-wide meta description and the home page's own description.                                                             |
| `brand.faviconPath`                    | The `<link rel="icon">` target and the asset the Access smoke test probes.                                                  |
| `deployment.workerName`                | The Worker `wrangler.jsonc` must declare; environments deploy as `<name>-<environment>`.                                    |
| `deployment.environments.*`            | Canonical site URL, Wrangler custom domains, deployment summaries, smoke-test defaults.                                     |
| `deployment.environments.*.visibility` | Who may read that environment: `private` (default) or `public`. See below.                                                  |
| `home.lede`                            | The paragraph under the home page heading, in full: where documents come from and what a reader may do with them.           |
| `home.recentLimit`                     | How many documents the "recently updated" band lists. A whole number of at least 1; defaults to 6.                          |
| `home.corpusIndex`                     | Whether the home page ends with the full index of every document. Defaults to `true`. See below.                            |
| `navigation.landingDocumentTitles`     | Titles that open the folder they sit in, most preferred first. Also picks the description the home page shows for a folder. |
| `navigation.sectionIndexPages`         | Whether each folder gets a generated page listing its contents at `/<folder-slug>/`.                                        |
| `sync.generatedBy`                     | The ownership marker stamped into every generated Markdown and TypeScript file.                                             |
| `sync.commitBotName`                   | Git author the sync workflow commits generated output as.                                                                   |
| `sync.defaultLocale`                   | Fallback locale for documents whose language cannot be determined.                                                          |

## Who may read the deployment

`visibility` decides what the platform asserts about an environment, and it
defaults to `private` — an omission fails in the recoverable direction.

|                                                        | `private`                                                             | `public`                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `public/robots.txt`                                    | must disallow every crawler                                           | must not disallow every crawler                          |
| `public/_headers` on `/*.md` and `/assets/generated/*` | `Cache-Control: private` and an `X-Robots-Tag`                        | must not carry `noindex`                                 |
| every page                                             | carries `<meta name="robots" content="noindex, nofollow, noarchive">` | carries no robots meta                                   |
| `ctcdocs-access-smoke`                                 | anonymous requests must be denied and a service token admitted        | anonymous requests must succeed; no service token needed |

Two scoping rules:

- **The built site follows the production environment.** `robots.txt`, the
  response headers and the meta tag are one artifact deployed everywhere, so
  they take the posture of the environment an unauthenticated reader can reach.
- **A smoke run follows the environment it probes**, matched by hostname. An
  address the configuration does not know is treated as private.

What visibility does not change: `workers.dev` and preview URLs stay disabled,
an environment binds exactly one custom domain, and `wrangler.jsonc` is still
checked against this file. A public portal wants one predictable address as much
as a private wiki does.

See [ADR-016](ADR/016-deployment-visibility.md).

## Environments

`deployment.environments` is an open set, not a fixed pair. Name the
environments a project actually has: `production` is required, anything else is
optional, and a project that promotes through a development host simply declares
one. Each name becomes a Wrangler environment and, in the deployment workflow,
one call per environment.

A name is lowercase letters, digits and hyphens, and may not start or end with a
hyphen. Two environments may not share a hostname — a Worker that answers on an
address another environment claims makes every check afterwards ambiguous.

`hostname` is derived from `url`, not written down.

The file is validated when it is imported, so a mistake fails the build rather
than reaching a deployment:

- `visibility`, where present, must be `private` or `public`;
- every environment URL must be a bare HTTPS origin — no credentials, path, or
  query — and no two may be equal;
- `brand.faviconPath` must be a root-relative path beginning with `/`;
- `sync.defaultLocale` must be at least two characters;
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
commit, by running a full sync (`ctcdocs-sync sync --full`) rather than by
editing generated files.

## What the home page shows

The page is composed of four blocks in a fixed order — the opening with search,
the folder cards, the recently updated band, and the full index — and two of
them are the project's to size.

`home.recentLimit` is how many rows the recent band lists. Six is a fortnight on
a slow corpus and an afternoon on a busy one, so the number belongs to the
deployment rather than to the platform. Documents with no recorded source
modification time are not in the band at all; they are still listed everywhere
else.

`home.corpusIndex` decides whether the page ends with every document, grouped by
folder. Keeping it is right for a corpus a reader can take in at a glance;
dropping it suits a deployment where each folder has a page of its own and the
home page is meant to be an entrance rather than a table of contents.

The two settings are coupled to `navigation.sectionIndexPages`. Where folder
pages are not generated, a folder card and a breadcrumb segment both link to
that folder's heading **inside** the index, so a configuration that drops the
index while `navigation.sectionIndexPages` is `false` is refused by
`ctcdocs-sync validate` and by the build. Turn folder pages on first.

One case ignores the switch: a project that has never synchronized still gets
the index, because it is the only block that explains an empty site instead of
hiding itself.

## What is not in the configuration file

**Secrets and per-environment addresses** are environment variables, listed in
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md#environment). `SYNC_SITE_BASE_URL`,
`SYNC_DEFAULT_LOCALE` and `CTCDOCS_BASE_URL` fall back to this file and only need
a value when a run should target something else, such as a separate test corpus.

**Brand artwork and color** are files, not values:

- `public/favicon.svg` — the mark, also shown beside the wordmark in
  the header.
- `src/styles/brand.css` — the accent triad for each theme.

They are files because the accent carries measured contrast ratios. The
accessibility suite runs axe against both themes and fails on a contrast
regression, so measure a replacement accent against the two grounds named in
`brand.css` before committing it. See [DESIGN.md](DESIGN.md).

**Editorial pages** — `src/content/docs/*.md` — are hand-written by the project
that owns the wiki, and sit alongside the generated corpus rather than inside
it.

**The deployment target itself** — `wrangler.jsonc` — is
hand-written, because Wrangler reads its own configuration file and cannot be
handed values from elsewhere. `ctcdocs-sync validate` fails when its Worker
name or either custom domain disagrees with `site.config.json`, so the
two cannot drift apart silently.

## Standing a project up

A project installs the packages; it does not fork this repository. What it owns
is its identity, its brand, its content and its workflows — the list in the
[README](../README.md#what-a-project-looks-like).

1. Write `site.config.json`.
2. Write `wrangler.jsonc` with the same Worker name and hostnames.
   `ctcdocs-sync validate` tells you if you missed one.
3. Add `public/favicon.svg` and the accent triads in `src/styles/brand.css`.
4. Point the sync at the Shared Drive with `GOOGLE_DRIVE_ID` and
   `GOOGLE_ROOT_FOLDER_ID`, following
   [GOOGLE_WORKSPACE_SETUP.md](GOOGLE_WORKSPACE_SETUP.md).
5. Create the Cloudflare Access application and custom domains, following
   [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md).
6. Set the repository and environment secrets and variables listed in
   [DEPLOYMENT.md](DEPLOYMENT.md).
7. Run a first sync, then the project's own gate:

```bash
ctcdocs-sync sync --full
```

## Why the checks stay honest

The browser suites take their sample documents from `data/docs-index.json` and
the generated asset tree rather than naming a document, so they assert the
shape of a corpus and pass against any of them. A test that hardcodes a slug, a
hostname, or a product name is a bug; use `loadSiteConfiguration` from
`@ctcstack/ctcdocs-core` and the helpers in
`packages/astro/tests/support/corpus-fixtures.ts` instead.

This is the property that lets one platform serve deployments it has never
heard of, and it is the first thing a contribution is checked against.
