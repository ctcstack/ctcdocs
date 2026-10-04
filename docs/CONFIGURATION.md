# Configuration

Everything that identifies one deployment of this platform lives in
`site.config.json`. No source file, test, or workflow carries a project
name of its own; they read this file. The rationale is recorded in
[ADR-012](ADR/012-project-configuration-layer.md).

## The configuration file

```json
{
  "signIn": {
    "workspaceDomains": ["example.com"]
  },
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
    "corpusIndex": true,
    "start": "about"
  },
  "navigation": {
    "landingDocumentTitles": ["Overview", "README", "About"],
    "sectionIndexPages": true
  },
  "sync": {
    "generatedBy": "CTCDOCS SYNC",
    "commitBotName": "ctcdocs-sync[bot]",
    "defaultLocale": "en",
    "largeImageMegabytes": 2,
    "largeDocumentCharacters": 40000
  }
}
```

| Value                                  | Where it shows up                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.name`                           | Reserved for prose that names the organization rather than the site.                                                                     |
| `brand.siteTitle`                      | Browser tab, header wordmark, home page heading, and both browser test suites.                                                           |
| `brand.siteDescription`                | Site-wide meta description and the home page's own description.                                                                          |
| `brand.faviconPath`                    | The `<link rel="icon">` target and an asset the access smoke test probes.                                                                |
| `deployment.workerName`                | The Worker `wrangler.jsonc` must declare; environments deploy as `<name>-<environment>`.                                                 |
| `deployment.environments.*`            | Canonical site URL, Wrangler custom domains, deployment summaries, smoke-test defaults.                                                  |
| `deployment.environments.*.visibility` | Who may read that environment: `private` (default) or `public`. See below.                                                               |
| `home.lede`                            | The paragraph under the home page heading, in full: where documents come from and what a reader may do with them.                        |
| `home.recentLimit`                     | How many documents the "recently updated" band lists. A whole number of at least 1; defaults to 6.                                       |
| `home.corpusIndex`                     | Whether the home page carries the full index, which is published at `/documents/` either way. Defaults to `true`.                        |
| `home.start`                           | Optional. The address of a hand-authored page, such as `about`; the opening links newcomers to it by its title.                          |
| `navigation.landingDocumentTitles`     | Titles that open the folder they sit in, most preferred first. Also picks the description the home page shows for a folder.              |
| `navigation.sectionIndexPages`         | Whether each folder gets a generated page listing its subfolders, then its documents, at `/<folder-slug>/`.                              |
| `navigation.nameScripts`               | Optional. The Unicode scripts a letter in a Drive name may belong to, such as `["Latin"]`. See below.                                    |
| `navigation.addresses`                 | Optional. `stable` (default) keeps an address through renames and moves; `follow-names` re-derives it from the Drive path on every sync. |
| `sync.generatedBy`                     | The ownership marker stamped into every generated Markdown and TypeScript file.                                                          |
| `sync.commitBotName`                   | Git author the sync workflow commits generated output as.                                                                                |
| `sync.defaultLocale`                   | Fallback locale for documents whose language cannot be determined.                                                                       |
| `sync.largeImageMegabytes`             | Optional. Megabytes (a million bytes each) above which the content health page notes an image. Above 0; defaults to 2.                   |
| `sync.largeDocumentCharacters`         | Optional. Characters of a document's text above which the content health page suggests splitting it. See below.                          |
| `signIn.workspaceDomains`              | The organization's Google Workspace domains, whose accounts may sign in. Required on a private deployment. See below.                    |
| `access`                               | Optional. Who may read which folder, by Google group. Only on a deployment whose every environment is private. See below.                |

## Who may read the deployment

`visibility` decides what the platform asserts about an environment, and it
defaults to `private` — an omission fails in the recoverable direction.

|                                                                                    | `private`                                                              | `public`                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| `public/robots.txt`                                                                | must disallow every crawler                                            | must not disallow every crawler                |
| `public/_headers` on `/*.md`, `/llms.txt`, `/*/llms.txt` and `/assets/generated/*` | `Cache-Control: private` and an `X-Robots-Tag`                         | must not carry `noindex`                       |
| every page                                                                         | carries `<meta name="robots" content="noindex, nofollow, noarchive">`  | carries no robots meta                         |
| `wrangler.jsonc`                                                                   | serves the build through the platform's Worker, which signs readers in | serves the build directly                      |
| `ctcdocs-access-smoke`                                                             | anonymous requests must be denied and a machine key admitted           | anonymous requests must succeed; no key needed |

Two scoping rules:

- **The built site follows the production environment.** `robots.txt`, the
  response headers and the meta tag are one artifact deployed everywhere, so
  they take the posture of the environment an unauthenticated reader can reach.
  Behind the Worker, Cloudflare does not apply `_headers`; the Worker sets the
  same headers itself, and `_headers` is still checked so the two cannot
  disagree. See [Cloudflare setup](CLOUDFLARE_SETUP.md#response-headers).
- **A smoke run follows the environment it probes**, matched by hostname. An
  address the configuration does not know is treated as private.

What visibility does not change: `workers.dev` and preview URLs stay disabled,
an environment binds exactly one custom domain, and `wrangler.jsonc` is still
checked against this file. A public portal wants one predictable address as much
as a private wiki does.

The `/*.md` and `llms.txt` rules also declare
`Content-Type: text/markdown; charset=utf-8` and
`Content-Type: text/plain; charset=utf-8`, whatever the visibility: a static
build discards the type an endpoint sets, and without the charset a browser or
an agent decodes every non-ASCII title wrongly. The access smoke test checks
both after a deployment. See [ADR-033](ADR/033-publish-llms-txt-indexes.md).

See [ADR-016](ADR/016-deployment-visibility.md).

## Signing in

A private deployment signs its readers in itself, with Google, in the
platform's Worker
([ADR-038](ADR/038-a-private-deployment-signs-readers-in-itself-with-google.md)):

```json
"signIn": {
  "workspaceDomains": ["example.com", "example.org"]
}
```

`workspaceDomains` lists every domain of the organization, the primary one and
any secondary ones. A Google account is admitted only when its ID token says
it belongs to one of them, and only while the directory snapshot lists it as
active. Domains are compared without regard to case; an empty list, a repeated
domain or an unknown key is an error. When there is exactly one domain, Google
is asked to offer only that domain's accounts.

`ctcdocs-sync validate` requires `signIn` on a deployment with any private
environment, and requires `wrangler.jsonc` and `wrangler.directory.jsonc` to
deploy the platform's two Workers — see
[Cloudflare setup](CLOUDFLARE_SETUP.md). The Worker is one artifact for every
environment, so a public environment of such a deployment is served through
it too, without sign-in. The Google client ID is
a variable in `wrangler.jsonc`; its secret and the rest are Worker secrets, not
configuration.

## AI assistants (MCP)

A private deployment can serve an MCP server through which people read the
site from their AI assistants — claude.ai, ChatGPT, Claude Code, Cursor and
others — as themselves
([ADR-041](ADR/041-agents-read-the-site-through-an-mcp-server-as-their-reader.md)):

```json
"mcp": {
  "enabled": true
}
```

A person adds `https://<host>/mcp` to their assistant, allows it once, and
signs in with Google as on the site. The assistant then finds and reads exactly
what that person may open, decided again on every request, so a change of
groups or a departure applies within the directory's refresh. Any client may
connect, from any account; the sign-in decides who reads.

`mcp` needs `signIn` and is refused while any environment is public. With it
on, `ctcdocs-sync validate` requires the bindings, schedule and compatibility
flag in [Cloudflare setup](CLOUDFLARE_SETUP.md#the-mcp-server), and the build
lists every document in the access map for the Worker to publish. Turned off,
or absent, the Worker serves no MCP or OAuth route, and the bindings may stay
in `wrangler.jsonc` so that turning it on again is one change.

How the server searches and how much it returns can be tuned for the
project's corpus, without a new version of the platform
([ADR-042](ADR/042-an-assistants-search-returns-the-passages-that-match.md)).
Every setting is optional, and the defaults are the values shown:

```json
"mcp": {
  "enabled": true,
  "search": {
    "chunks": 50,
    "vectorThreshold": 0.2,
    "keywordMatch": "or",
    "contextChunks": 0,
    "reranking": {
      "enabled": true,
      "model": "@cf/baai/bge-reranker-base",
      "threshold": 0
    },
    "results": 10,
    "passagesPerResult": 3,
    "passageCharacters": 24000
  },
  "fetchCharacters": 100000
}
```

| Setting                          | Meaning                                                                                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.search.chunks`              | Chunks asked of AI Search for each query, 1 to 50.                                                                                                                                                                               |
| `mcp.search.vectorThreshold`     | Vector similarity, 0 to 1, below which AI Search drops a chunk vector search alone found; a keyword match stays. AI Search ignores it while reranking is on, so it acts only with `reranking.enabled` false.                     |
| `mcp.search.keywordMatch`        | `or`: a keyword match needs any word of the query; `and`: every word.                                                                                                                                                            |
| `mcp.search.contextChunks`       | Neighbouring chunks joined to each side of a match, 0 to 3. A chunk of AI Search's default size is already longer than a passage, so they add only text the Worker cuts away; they help when an instance indexes smaller chunks. |
| `mcp.search.reranking.enabled`   | Whether AI Search reranks the chunks before the Worker groups them.                                                                                                                                                              |
| `mcp.search.reranking.model`     | The reranking model.                                                                                                                                                                                                             |
| `mcp.search.reranking.threshold` | Reranking score, 0 to 1, below which a chunk is dropped; 0 keeps every chunk. Needed documents can score near 0, those in another language than the question first, so a threshold cuts them with the noise.                     |
| `mcp.search.results`             | Documents a search returns at most: no more than `chunks`, which is also the default when it is under 10.                                                                                                                        |
| `mcp.search.passagesPerResult`   | Passages each document shows at most.                                                                                                                                                                                            |
| `mcp.search.passageCharacters`   | Characters of passage text a search returns in all; at least 100 for each result.                                                                                                                                                |
| `mcp.fetchCharacters`            | Characters `fetch` returns at most, 1,000 or more; a longer document is cut there, and the content health page names it.                                                                                                         |

The build writes the resolved values into the access map, so a change takes
effect with the project's next deploy. ADR-042 records what each setting did
when the defaults were first measured, and what AI Search does with the
settings its documentation leaves unsaid; measure a change against the
project's own questions before keeping it.

## Who may read which folder

A private deployment may close folders to everyone but named Google groups:

```json
"access": {
  "admins": ["docs-admins@example.com"],
  "rules": [
    { "folder": "<Drive folder ID>", "label": "Handbook", "readers": ["*"] },
    {
      "folder": "<Drive folder ID>",
      "label": "Finance",
      "readers": ["finance@example.com", "finance-leads@example.com"]
    }
  ]
}
```

- **A rule covers its folder and everything below it.** `folder` is the Drive
  folder's ID, so renaming or moving the folder does not move the rule.
  `label` is its name, for whoever reviews the configuration; when it no
  longer matches the folder's name in Drive or on the site, the content health
  page and the sync job summary say so.
- **`readers` is a list of group addresses, or `["*"]`** for every signed-in
  member. Addresses are compared without regard to case.
- **A document's readers are the groups every rule on its folder chain
  names.** A rule below another can only narrow it; a group it names that the
  rule above does not admits no one there, and is reported.
- **A folder with no rule on it or above it is closed** to everyone but the
  `admins` groups, who read everything. The reports list every such folder, so
  a new folder does not stay closed unnoticed. A rule may name the Drive root
  to open everything not otherwise ruled.
- **Without an `access` section** every document is open to every member, as
  before. The section is refused while any environment is public, and an
  unknown key in it is an error.

The deployment's Worker enforces the rules on every request. The build follows
them too: the `llms.txt` indexes describe a document only in an index of its
own class, and a home page folder card takes its description only from a
document every member may read. See
[ADR-039](ADR/039-open-a-folder-only-to-the-google-groups-its-rule-names.md).

**Admins see what the rules amount to** at `/access-review/`, which the build
writes only when the project has an `access` section: every folder with its
readers and how each group comes to read it, what needs attention, a view as a
set of groups, and, for a folder without a rule, the rule to paste here. The
address is reserved like the platform's other routes. See
[ADR-045](ADR/045-an-access-review-page-shows-admins-who-may-read-each-folder.md)
and [Who may read what](OPERATIONS.md#who-may-read-what).

**A move in Drive never widens a document's readers by itself.** A change to
these rules takes effect at once, wider or narrower: it is reviewed where this
file is. A document moved — or under a folder moved — to a place whose rules
would let more people read it is published to the readers both places allow,
and listed under Fix now on the content health page, until a rule on its new
folder or a folder above it is added or changed. Meanwhile its folder's page
lists it by title alone. A move back, or a move that narrows, takes effect at
once.

Every build writes `.ctcdocs/access-map.json`, outside `dist`, naming the
access class of every file it built, and one search bundle per class:
`/pagefind/` for every member and `/pagefind-<class>/` for each other class.
The search box merges the bundles the Worker lists for the reader at
`/_kb/classes`; where that route does not answer, it searches `/pagefind/`
alone. Once rules
exist, a built file the map cannot place fails the build, and so does a file
that repeats eight words or more of a document its readers may not open.
Add `.ctcdocs/` to the project's `.gitignore`.

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
- `navigation.addresses`, where present, must be `stable` or `follow-names`;
- `navigation.nameScripts`, where present, must be a non-empty list of distinct
  Unicode script names that a `\p{Script=…}` escape accepts, such as `Latin`
  or `Cyrillic`;
- `sync.largeDocumentCharacters`, where present, must be a whole number from 1
  to the characters an assistant reads of a document (see below);
- `sync` and `mcp` accept only the settings this page lists;
- no required value may be empty.

### Changing `sync.generatedBy`

This one is not cosmetic. The marker is written into every generated file, so
changing it rewrites the whole generated corpus. Do it deliberately, in its own
commit, by running a full sync (`ctcdocs-sync sync --full`) rather than by
editing generated files.

## Documents too long to read whole

The content health page measures each document by the text `fetch` returns,
its Markdown version without the front matter, and names those over two lines
([ADR-043](ADR/043-content-health-names-documents-too-long-to-read-whole.md)):
`sync.largeDocumentCharacters`, worth splitting, and `mcp.fetchCharacters`,
which assistants read only the beginning of (100,000 with the MCP server
off). The first is 40,000 unless the project sets it, and never more than
the second: unset, it is the second where the second is lower; set above
it, the configuration fails. The sync reads both, so a change shows on the
page after the next sync, without exporting anything again.

## What the home page shows

The page is composed of four blocks in a fixed order — the opening with search,
the folder cards, the recently updated band, and the full index — and two of
them are the project's to size.

`home.recentLimit` is how many rows the recent band lists. Six is a fortnight on
a slow corpus and an afternoon on a busy one, so the number belongs to the
deployment rather than to the platform. Documents with no recorded source
modification time are not in the band at all; they are still listed everywhere
else.

`home.start` names the page a newcomer reads first: the address of a page the
project writes by hand under `src/content/docs`, such as `about`. The opening
links to it with that page's own title, so renaming the page renames the link,
and an address with no page behind it fails the build. Without the setting the
opening carries no such link.

`home.corpusIndex` decides whether the home page ends with every document,
grouped by folder. Keeping it is right for a corpus a reader can take in at a
glance; dropping it suits a deployment where the home page is meant to be an
entrance rather than a table of contents.

**The index is published either way.** It has a page of its own at
`/documents/`, served on every deployment, and the home page either carries a
copy of it or links to it. Folder headings are addressable there —
`/documents/#<folder>` — which is where a folder card and a breadcrumb segment
land when that folder has no page of its own. See
[ADR-017](ADR/017-full-index-page.md).

**Search finds the home page by its title alone.** Everything below the title,
`home.lede` included, repeats what the documents hold or is interface text, so
it is kept out of the index. A folder with no page of its own is found by its
name at its heading in the full index. See
[ADR-036](ADR/036-index-the-home-page-by-its-title-and-a-folder-where-it-has-its-address.md).

Two consequences worth knowing:

- `documents` is a reserved address, as are `auth`, `pagefind` and `assets`,
  which the Worker, search and original files use. A new Drive folder or
  document named "Documents" is allocated a suffixed slug instead, and a corpus
  that claimed the address before it was reserved fails `ctcdocs-sync validate`
  until the source is renamed in Drive.
- A project that passes its own `sidebarPrefix` to `ctcdocsConfig` links the
  page itself. The platform default links it under "Documentation".

## What is not in the configuration file

**Secrets and per-environment addresses** are environment variables, listed in
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md#environment), or Worker secrets,
listed in [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md#the-site-worker).
`SYNC_SITE_BASE_URL`, `SYNC_DEFAULT_LOCALE` and `CTCDOCS_BASE_URL` fall back to
this file and only need a value when a run should target something else, such
as a separate test corpus.

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

**The deployment target itself** — `wrangler.jsonc`, and on a private
deployment `wrangler.directory.jsonc` — is hand-written, because Wrangler reads
its own configuration file and cannot be handed values from elsewhere.
`ctcdocs-sync validate` fails when a Worker name or a custom domain disagrees
with `site.config.json`, or when a private deployment's files lack any part of
the gate, so the two cannot drift apart silently.

## Standing a project up

A project installs the packages; it does not fork this repository. What it owns
is its identity, its brand, its content and its workflows — the list in the
[README](../README.md#what-a-project-looks-like). The whole setup, step by
step, with every value and where it goes, is
[Setting up a CTCDocs site](NEW_PROJECT.md).

## Why the checks stay honest

The browser suites take their sample documents from `data/docs-index.json` and
the generated asset tree rather than naming a document, so they assert the
shape of a corpus and pass against any of them. A test that hardcodes a slug, a
hostname, or a product name is a bug; use `loadSiteConfiguration` from
`@ctcstack/ctcdocs-core` and the helpers in
`packages/astro/tests/support/corpus-fixtures.ts` instead.

This is the property that lets one platform serve deployments it has never
heard of, and it is the first thing a contribution is checked against.
