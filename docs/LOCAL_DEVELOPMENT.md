# Local development

## Requirements

- the Node.js version from `.node-version`;
- the pnpm version from the root `package.json`;
- Git.

Global Astro, Wrangler, and test runners are not required. Project versions are
locked in `pnpm-lock.yaml`.

## First run

```bash
corepack enable
pnpm install --frozen-lockfile
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium
pnpm verify
pnpm dev
```

The local wiki contains synthetic Markdown pages only. Production Google Drive
content is not required for development.

## Commands

| Command                        | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `pnpm dev`                     | Start the Astro development server                       |
| `pnpm build`                   | Run Astro checks and build the static wiki               |
| `pnpm verify`                  | Run the canonical local quality gate                     |
| `pnpm test:coverage`           | Run unit and property tests with coverage                |
| `pnpm test:spikes`             | Run executable Phase −1 fixture regressions              |
| `pnpm test:search`             | Exercise the built Pagefind index and multilingual case  |
| `pnpm test:ux`                 | Run local Axe, keyboard, and mobile browser checks       |
| `ctcdocs-sync validate`        | Check content and deployment security invariants         |
| `pnpm sync:inventory`          | List and validate Drive metadata without content export  |
| `pnpm sync:dry-run`            | Export, normalize, stage, and validate without writes    |
| `pnpm sync`                    | Replace generated output after complete validation       |
| `pnpm sync:full`               | Force re-export of every selected Google Doc             |
| `pnpm sync --file <id>`        | Reexport one corpus document without unrelated deletion  |
| `pnpm sync --reseed-slug <id>` | Explicitly change one stable URL and add a redirect      |
| `pnpm deploy:dry-run`          | Validate both Wrangler targets without upload            |
| `pnpm deploy:development`      | Deploy protected dev; bootstrap/approved operations only |
| `pnpm test:access:preflight`   | Verify anonymous denial and service-token admission      |
| `pnpm test:access:post-deploy` | Verify the complete protected production surface         |
| `pnpm test:e2e`                | Run browser-based Cloudflare Access and Axe smoke        |
| `pnpm deploy:production`       | Deploy protected prod; approved incident operations only |

## Environment

Copy variable names from `.env.example` into the ignored repository-root
`.env`, which is where the sync CLI and the Access smoke scripts read them
from. Wrangler reads its own `apps/wiki/.env` instead, from its package
directory; the two files are separate and neither is a fallback for the other.
Never store access tokens, Drive IDs, credentials, or exported internal content
in documentation or fixtures.

The production inventory configuration uses:

```text
GOOGLE_DRIVE_ID
GOOGLE_ROOT_FOLDER_ID
GOOGLE_IGNORED_FOLDER_IDS
SYNC_SITE_BASE_URL
```

`GOOGLE_ACCESS_TOKEN` must be short-lived. The supported integration path
obtains it through the protected GitHub WIF workflow; it is intentionally not
listed in `.env.example`.

Authenticated E2E uses:

```text
CTCDOCS_BASE_URL
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Cloudflare deployment additionally uses:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Keep deployment credentials out of the normal development environment unless
you are performing the approved development bootstrap or a production
incident operation. The canonical `pnpm verify` command performs only Wrangler
dry-runs and does not upload. Normal remote deployments use the protected
GitHub workflows documented in [Deployment](DEPLOYMENT.md).

For an approved direct local deployment, Wrangler loads these two deployment
values from the ignored `apps/wiki/.env`. The repository-root `.env` remains
the source for the Access smoke scripts. Do not reuse development credentials
for production.

## Generated paths

The pipeline may change only the paths declared in
`packages/shared/src/generated-paths.ts`. It prepares a complete staged tree,
validates it, and replaces generated targets with rollback protection. Do not
add files to generated directories manually.
