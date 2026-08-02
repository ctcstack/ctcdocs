# Cloudflare environment setup

## Approved boundary

The two protected deployment targets are:

```text
Zone: example.com
Development hostname: docs-dev.example.com
Development Worker: example-docs-development
Production hostname: docs.example.com
Production Worker: example-docs-production
Application type: Cloudflare Access self-hosted
Identity provider: CTCStack Google Workspace
```

The hostnames and Worker name above come from `site.config.json`; see
[Configuration](CONFIGURATION.md) before pointing this platform at a different
zone.

The wiki, static assets, Pagefind index, `robots.txt`, and 404 page share one
authorization boundary. There is no public application origin.

Generated document Markdown at `/<stable-slug>/index.md` and its original
images under `/assets/generated/` are part of the same boundary. They must never
be exposed through a separate hostname or Access bypass.

## Worker configuration

`wrangler.jsonc` is the source of truth. It defines named
`development` and `production` environments with separate custom domains:

```jsonc
{
  "name": "example-docs",
  "workers_dev": false,
  "preview_urls": false,
  "env": {
    "development": {
      "workers_dev": false,
      "preview_urls": false,
      "routes": [
        {
          "pattern": "docs-dev.example.com",
          "custom_domain": true,
        },
      ],
    },
    "production": {
      "workers_dev": false,
      "preview_urls": false,
      "routes": [
        {
          "pattern": "docs.example.com",
          "custom_domain": true,
        },
      ],
    },
  },
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash",
  },
}
```

Wrangler creates or updates each custom-domain binding. `workers_dev=false`
removes the `workers.dev` routes and `preview_urls=false` prevents public
version URLs. Every command must select a named environment explicitly.

Validate without uploading:

```bash
pnpm build
pnpm deploy:dry-run:development
pnpm deploy:dry-run:production
```

## Browser caching and navigation prefetch

`public/_headers` is copied into the static build and controls browser
caching for responses served by Workers Static Assets. Protected HTML routes use
`Cache-Control: private, max-age=60, must-revalidate` so rapid back-and-forth
navigation can reuse the browser cache while Access revocation and content
updates have at most a short local freshness window.

Raw Markdown and generated images use the same private, short-lived cache policy
plus `X-Robots-Tag: noindex, noarchive` and `X-Content-Type-Options: nosniff`.
This covers both the `/assets/generated/` originals and the fingerprinted image
files that Astro emits under `/_astro/`, so an image keeps the same policy
whichever route serves it.

`/*.md` additionally declares `Content-Type: text/markdown; charset=utf-8`. A
static Astro build writes each endpoint's body to a file and discards the
`Content-Type` the endpoint set, so the asset server would otherwise derive the
type from the `.md` extension alone. Without an explicit charset a browser falls
back to a legacy single-byte encoding and corrupts every non-ASCII character in
the document. This is invisible in local development, because the local asset
server appends the charset on its own; only the deployed response proves it, so
the post-deploy smoke asserts the full content type.

Astro-fingerprinted JavaScript, CSS, and font files under `/_astro/` use a
one-year immutable cache lifetime. The policy intentionally does not apply to
generated images or Pagefind data because those assets can contain internal wiki
content and must not remain fresh in a browser cache for a year.

`/favicon.svg` is brand artwork rather than wiki content and is requested by
every document page, so it uses a one-day public lifetime. Without it the
browser revalidates the icon on every navigation.

Every navigation is a full document load because Starlight is a multi-page
application. Browser developer tools therefore list all subresources of the new
page on each navigation, including the ones answered from the browser cache.
Read the size and time columns — `(memory cache)`, `(disk cache)`, or `304` mean
no payload was transferred — rather than the number of rows.

Starlight enables prefetching for all internal links. The Astro configuration
changes the default strategy from `hover` to `tap`, which avoids speculative
requests when a pointer merely crosses the sidebar while preserving a prefetch
immediately before an intentional navigation.

Cloudflare Access login and denial responses are not static asset responses and
are not affected by `_headers`. Keep `Disable cache` cleared when validating in
browser developer tools; otherwise the browser will intentionally bypass these
rules.

## Access application

Create one self-hosted application per hostname:

```text
docs-dev.example.com/*
docs.example.com/*
```

Recommended session duration:

```text
24 hours
```

The employee policy is:

```text
Action: Allow
Include: Login Methods = CTCStack Google Workspace
```

Accept only the configured Workspace identity provider. Do not add `Everyone`,
One-time PIN, a broad email suffix, or a permanent `Bypass Everyone` policy.
No separate employee group is required because the approved product decision
grants access to every identity in the Workspace organization, including
secondary Workspace domains.

If account-wide **Require Access protection** is considered, audit every
public hostname in the Cloudflare account first. That setting is deny-by-default
for the entire account and must not be enabled casually on an account serving
other public applications.

## Machine smoke policy

Create a separate Access service token and policy for each environment:

```text
Action: Service Auth
Include: Service Token = <wiki smoke token>
```

Store each client ID and secret only in the matching GitHub
`development-smoke` or `production-smoke` environment, or an ignored local
`.env`. The smoke client sends:

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

The service token must not be placed in the Astro bundle, Wrangler
configuration, repository variables, workflow artifacts, or documentation.

## Deploy API token

Create a dedicated Cloudflare API token for each deployment environment. Start
from the **Edit Cloudflare Workers** template, then restrict each token to:

- the project's Cloudflare account;
- the project's zone;
- Worker script deployment;
- Worker route/custom-domain management required by the committed route.

Do not grant Access Apps and Policies, Access Service Tokens, broad DNS
administration, account administration, or access to unrelated accounts and
zones. Store each token only as `CLOUDFLARE_API_TOKEN` in its matching
`development-deploy` or `production-deploy` environment; store the non-secret
account ID as an environment variable.

## Bootstrap Worker migration

The Phase 0 synthetic deployment used `ctc-wiki-synthetic-staging` on the
production hostname. Before the first named-environment production deployment:

1. keep its Access application active;
2. run the anonymous and service-token preflight against the hostname;
3. remove the custom-domain binding from the bootstrap Worker if Cloudflare
   reports a route conflict;
4. immediately deploy `example-docs-production` with the committed configuration;
5. run the post-deploy smoke;
6. delete the obsolete bootstrap Worker only after the new deployment is
   protected and recoverable.

Never detach Access while transferring the custom domain.

The first development custom-domain binding has a separate synthetic bootstrap
procedure because the preflight cannot reach a hostname that does not exist
yet. Follow [Development and production deployment](DEPLOYMENT.md) exactly.

## Verification

Local or protected-environment preflight:

```bash
pnpm test:access:preflight
```

Post-deploy black-box verification:

```bash
pnpm test:access:post-deploy
```

The checks require:

- anonymous denial for HTML, raw Markdown, Pagefind, SVG, and a missing route;
- successful service-token admission;
- protected home page and `noindex` metadata;
- protected Pagefind JavaScript;
- protected Markdown with the expected content type and metadata;
- protected favicon;
- restrictive `robots.txt`;
- protected custom 404 handling.

In the Cloudflare dashboard, also verify:

- the only wiki domains are the approved development and production domains;
- `workers.dev` routes are disabled for both Workers;
- Preview URLs are disabled for both Workers;
- there is no public Pages project, GitHub Pages site, or legacy Worker route;
- Access authentication logs show the Workspace and service-token policies.

## Official references

- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Workers Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Require Access protection](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/require-access-protection/)
