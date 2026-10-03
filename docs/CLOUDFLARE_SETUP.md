# Cloudflare environment setup

## The boundary

A private deployment is served through the platform's Worker, which runs
before every asset and decides every request itself (ADR-038): readers sign in
with Google, machines present a key, and each file is served only to the
readers its access class names (ADR-039). There is no Cloudflare Access
application in front of it, and no public origin behind it.

The wiki, static assets, Pagefind bundles, `robots.txt`, the 404 page,
generated Markdown at `/<slug>/index.md`, originals under `/assets/generated/`
and the `llms.txt` indexes all sit behind that one Worker. None may be exposed
through a second hostname, a `workers.dev` address or a version preview URL.

A deployment is two Workers per environment and one KV namespace:

| Piece                    | Configuration              | What it holds                                                    |
| ------------------------ | -------------------------- | ---------------------------------------------------------------- |
| The site Worker          | `wrangler.jsonc`           | The build, the access map, the Google client, the session secret |
| The directory Worker     | `wrangler.directory.jsonc` | The directory reader's key; a schedule; no route                 |
| The `KB_STATE` namespace | both files                 | The directory snapshot, the groups' pinned IDs, the machine keys |

A deployment is gated — served through the Worker — when any of its
environments is private. A wholly public deployment is a plain Workers Static
Assets site with neither Worker nor namespace; most of this page does not apply
to it.

Turn on **SSL/TLS → Edge Certificates → Always Use HTTPS** for the zone. The
Worker also sends a page asked for over HTTP to HTTPS, refuses anything else
there before it reads a cookie or a key, and sends `Strict-Transport-Security`.

The hostnames and the Worker name come from `site.config.json`; see
[Configuration](CONFIGURATION.md) before pointing this platform at a different
zone.

## Plan

Use **Workers Paid**. Behind the Worker every request — each page, script,
image and search fragment — is a Worker request, and the free plan stops at
100,000 a day. The directory refresh also makes a few requests per group, and
the free plan allows 50 per run.

## The site Worker

`wrangler.jsonc` is hand-written, because Wrangler reads it itself.
`ctcdocs-sync validate` fails when it disagrees with `site.config.json` or
lacks any part of the gate:

```jsonc
{
  "name": "example-docs",
  "main": "node_modules/@ctcstack/ctcdocs/worker/index.ts",
  "compatibility_date": "2026-07-30",
  "workers_dev": false,
  "preview_urls": false,
  "alias": {
    "ctcdocs-access-map": "./.ctcdocs/access-map.json",
  },
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash",
    "binding": "ASSETS",
    "run_worker_first": true,
  },
  "env": {
    "production": {
      "workers_dev": false,
      "preview_urls": false,
      "routes": [{ "pattern": "docs.example.com", "custom_domain": true }],
      "kv_namespaces": [{ "binding": "KB_STATE", "id": "<namespace ID>" }],
      "vars": { "GOOGLE_CLIENT_ID": "<client ID>.apps.googleusercontent.com" },
    },
  },
}
```

- `main` and the `ctcdocs-access-map` alias bundle the platform's Worker with
  the access map of the build it serves, so the two deploy and roll back
  together.
- `run_worker_first` sends every request to the Worker, including requests for
  files that exist.
- `workers_dev: false` and `preview_urls: false` leave the custom domain as the
  only address. Validation refuses anything else.
- `GOOGLE_CLIENT_ID` is not a secret, so it is a variable.

Each environment's secrets are set once, with the environment named:

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

| Secret                    | Value                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_SECRET`    | The OAuth client's secret, from [Google Workspace setup](GOOGLE_WORKSPACE_SETUP.md)         |
| `SESSION_SECRET`          | At least 32 random characters, for example `openssl rand -base64 48`; one per environment   |
| `SESSION_SECRET_PREVIOUS` | Optional. The secret being rotated out; see [Operations](OPERATIONS.md#credential-rotation) |

Machine keys are not secrets of the Worker but records in the KV namespace; see
[Machine keys](#machine-keys).

Without the client or the session secret the Worker admits no one and says the
site is not configured; it never falls open.

## The directory Worker

`wrangler.directory.jsonc` deploys the scheduled Worker that keeps the
directory snapshot (ADR-040). It has no route, so the one credential it holds
is never in the Worker that parses readers' requests:

```jsonc
{
  "name": "example-docs-directory",
  "main": "node_modules/@ctcstack/ctcdocs/worker/directory/index.ts",
  "compatibility_date": "2026-07-30",
  "workers_dev": false,
  "preview_urls": false,
  "alias": {
    "ctcdocs-access-map": "./.ctcdocs/access-map.json",
  },
  "triggers": { "crons": ["*/10 * * * *"] },
  "env": {
    "production": {
      "workers_dev": false,
      "preview_urls": false,
      "kv_namespaces": [{ "binding": "KB_STATE", "id": "<namespace ID>" }],
    },
  },
}
```

Its name is the site Worker's with `-directory` appended, it binds the same
namespace in each environment, and validation checks both. Its only secret is
the directory reader's service account key, as the JSON file Google issued:

```bash
pnpm exec wrangler secret put DIRECTORY_KEY --config wrangler.directory.jsonc --env production < directory-reader.json
```

Delete the file afterwards. The key exists in the secret and nowhere else.

## The KV namespace

Create one namespace per environment and put its ID in both files:

```bash
pnpm exec wrangler kv namespace create example-docs-production-state
```

The directory Worker writes the snapshot and the pins; an operator writes the
machine keys. The deploy token below can do neither, so these commands, and
the KV commands in [Operations](OPERATIONS.md), run with a login or a token of
their own that has **Workers KV Storage** permission.

## Response headers

Cloudflare does not apply `_headers` to a response a Worker returns, so behind
the Worker the policy lives in the Worker:

| Response                                                              | `Cache-Control`                        |
| --------------------------------------------------------------------- | -------------------------------------- |
| Fingerprinted scripts, styles and fonts under `/_astro/`              | `public, max-age=31556952, immutable`  |
| Everything else the build holds: pages, Markdown, images, search data | `private, max-age=60, must-revalidate` |
| Anything that depends on who asks: sign-in, `/_kb/*`, refusals        | `no-store`                             |

Every response also carries `X-Robots-Tag: noindex, nofollow, noarchive`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and
`Strict-Transport-Security: max-age=31536000`. Signing out clears the
browser's cache of the site. Markdown
is served as `text/markdown; charset=utf-8` and `llms.txt` as
`text/plain; charset=utf-8`, because a static build discards the type an
endpoint set and a browser without a charset corrupts every non-ASCII
character. Every HTML page carries a Content Security Policy admitting the
site's own scripts, the inline scripts the build hashed, and nothing else.

The short private lifetime lets back-and-forth navigation reuse the browser
cache while a revoked reader or an updated document is stale for a minute at
most. Generated images and search data are never immutable, because they can
contain internal content.

`public/_headers` is still validated against the declared visibility, and still
governs a wholly public deployment, which has no Worker; a public environment
of a gated deployment gets the charset, `nosniff` and fingerprinted-asset
headers from the Worker. A gated deployment has no `public/_redirects`:
validation refuses one, because the asset store would apply it before the
Worker's decision, and the Worker refuses any redirect the store answers with.

Starlight prefetches internal links; the preset changes the strategy from
`hover` to `tap`, so a pointer crossing the sidebar does not fetch pages.
Keep **Disable cache** cleared when inspecting caching in browser developer
tools.

## Machine keys

The smoke test, and any agent a team runs, read the site with a machine key
rather than a browser session. A key belongs to the environment that issued
it, has a name, an owner, the groups it reads as and an expiry of at most 90
days, and is never an administrator. Issue one with:

```bash
pnpm exec ctcdocs-machine-key --name smoke --owner ops@example.com --days 90
```

The command prints the key once and a record. The deployment keeps only the
records, which hold the keys' hashes, as one JSON list under the key
`machine-keys` in the environment's KV namespace; adding, listing and revoking
them is in [Operations](OPERATIONS.md#machine-keys). They live in KV rather
than in a Worker secret because a rollback restores a version's secrets, and
would bring a revoked key back. A smoke key needs no group: it reads what
every member reads.

Never put a key in the Astro bundle, Wrangler configuration, repository
variables, workflow artifacts or documentation.

## Deploy API token

Create a dedicated Cloudflare API token for each deployment environment. Start
from the **Edit Cloudflare Workers** template, then:

- restrict it to the project's account and zone;
- keep Worker script deployment and the Worker route or custom-domain
  permission the committed route needs;
- **remove Workers KV Storage**. Deploying a Worker with a KV binding does not
  need it, and without it the token cannot write the snapshot or mint a
  machine key.

Do not grant Access, broad DNS administration, account administration, or
access to unrelated accounts and zones. Store each token only as
`CLOUDFLARE_API_TOKEN` in its matching `<environment>-deploy` GitHub
environment, with the non-secret account ID as a variable.

## Moving a deployment off Cloudflare Access

A deployment that stood behind an Access application moves in this order, so
there is no moment when content is served unprotected:

1. Set up the Google client, the directory reader, the namespace, both Workers'
   configuration, every secret above and the smoke key's record. Add
   `CTCDOCS_MACHINE_KEY` to the smoke environment beside the Access service
   token; the smoke test sends both.
2. Deploy the directory Worker, put its key, and wait for its first refresh:
   `pnpm exec wrangler tail example-docs-directory-production` shows
   `directory-refreshed`. With no snapshot the site Worker admits no session.
3. Deploy the site normally. Access still stands in front; readers sign in
   twice for a moment, once to Access and once to the site.
4. Sign in as a member, as a member of a restricted group and as an admin;
   check `/_kb/status` as the admin.
5. Delete the Access application and its service token, and remove
   `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from the smoke
   environment.
6. Run the deployment again, so the smoke test proves the boundary with the
   Worker alone, and add the scheduled anonymous probe.

Never roll back to a version deployed before step 3 once Access is gone: it
serves everything to everyone. The rollback workflow refuses any version
without the gate's mark.

## Verification

Before and after a deployment the smoke test requires, of a private
environment:

- anonymous denial — 401, or a redirect to `/auth/sign-in` — for the home
  page, raw Markdown, the favicon, the Pagefind runtime, the agent index and a
  missing route;
- machine-key admission to the home page and to the Markdown of a document
  every member may read, with `noindex` metadata, the private cache policy and
  the Markdown content type;
- the Pagefind runtime, the agent index, the favicon, a restrictive
  `robots.txt` and the custom 404 page, read with the key.

`ctcdocs-verify-gate` checks every built file against its class before the
deployment, without a network. `project-probe.yml` repeats the anonymous
checks on a schedule.

In the Cloudflare dashboard, also verify:

- the only wiki domains are the configured ones;
- `workers.dev` routes and Preview URLs are disabled for every Worker;
- the directory Worker has no route and a ten-minute cron trigger;
- there is no public Pages project, GitHub Pages site, or legacy Worker route.

## Official references

- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Static Assets: run the Worker first](https://developers.cloudflare.com/workers/static-assets/binding/#run_worker_first)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers authorization and bindings](https://developers.cloudflare.com/workers/authorization/workers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
