# Setting up a CTCDocs site

Follow this page top to bottom. At the end you have a documentation site built
from a Google Shared Drive, where people sign in with their Google Workspace
account, and that updates itself twice a day.

Every value you collect along the way — an ID, a key, an address — is listed in
[The values sheet](#the-values-sheet) with where it goes. Keep the sheet open.

The pages linked from here explain _why_ things work as they do. You do not need
them to finish.

## Who and what you need

People, or one person with all of these:

- a **Google Workspace super administrator** — for one role assignment in the
  Admin console;
- someone who can **create a project in Google Cloud** inside your Workspace
  organization;
- an **admin of a Cloudflare account** whose DNS serves the domain the site will
  live on;
- an **admin of a GitHub organization or account** — for a private repository
  and its settings.

On your computer:

- Node.js 22.12 or newer, below 23, and pnpm — any recent version: the project
  pins the one it needs;
- the `gcloud` command-line tool, signed in;
- `git` and `openssl`.

Decide three things now:

| Decision     | Example            | Rules                                                     |
| ------------ | ------------------ | --------------------------------------------------------- |
| Site address | `docs.example.com` | A name on a domain in your Cloudflare account; not in use |
| Worker name  | `example-docs`     | Lowercase letters, digits and hyphens                     |
| Repository   | `your-org/docs`    | Private: it holds every document                          |

## The values sheet

Fill this in as you go. Keep secret values in a password manager, never in the
repository or a chat.

| #   | Value                     | Example                                                                                | Secret | You get it in | It goes to                                                                                                                                         |
| --- | ------------------------- | -------------------------------------------------------------------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Site address              | `docs.example.com`                                                                     |        | your decision | `site.config.json` → `deployment.environments.production.url` (as `https://…`); `wrangler.jsonc` → `routes[0].pattern`; the redirect URI in step 5 |
| 2   | Worker name               | `example-docs`                                                                         |        | your decision | `site.config.json` → `deployment.workerName`; `wrangler.jsonc` → `name`; `wrangler.directory.jsonc` → `name`, with `-directory` added              |
| 3   | Workspace domains         | `example.com`                                                                          |        | step 3        | `site.config.json` → `signIn.workspaceDomains`                                                                                                     |
| 4   | Shared Drive ID           | `0AbCdEfGhIjKlUk9PVA`                                                                  |        | step 4        | GitHub `production-sync` → variable `GOOGLE_DRIVE_ID`                                                                                              |
| 5   | Root folder ID            | `1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345`                                                    |        | step 4        | GitHub `production-sync` → variable `GOOGLE_ROOT_FOLDER_ID`                                                                                        |
| 6   | Google Cloud project ID   | `example-docs-platform`                                                                |        | step 4        | GitHub `production-sync` → variable `GCP_PROJECT_ID`                                                                                               |
| 7   | Federation provider       | `projects/123456789012/locations/global/workloadIdentityPools/github/providers/github` |        | step 4        | GitHub `production-sync` → variable `GCP_WIF_PROVIDER`                                                                                             |
| 8   | Sync service account      | `docs-sync@example-docs-platform.iam.gserviceaccount.com`                              |        | step 4        | GitHub `production-sync` → variable `GCP_SYNC_SERVICE_ACCOUNT`                                                                                     |
| 9   | OAuth client ID           | `123456789012-abc.apps.googleusercontent.com`                                          |        | step 5        | `wrangler.jsonc` → `env.production.vars.GOOGLE_CLIENT_ID`                                                                                          |
| 10  | OAuth client secret       | `GOCSPX-…`                                                                             | yes    | step 5        | Cloudflare, site Worker secret `GOOGLE_CLIENT_SECRET` (step 10)                                                                                    |
| 11  | Directory reader key file | `~/directory-key.json`                                                                 | yes    | step 6        | Cloudflare, directory Worker secret `DIRECTORY_KEY` (step 10); then delete the file                                                                |
| 12  | Cloudflare account ID     | `0123456789abcdef0123456789abcdef`                                                     |        | step 8        | GitHub `production-deploy` → variable `CLOUDFLARE_ACCOUNT_ID`; your `.env`                                                                         |
| 13  | Cloudflare deploy token   | `…`                                                                                    | yes    | step 8        | GitHub `production-deploy` → secret `CLOUDFLARE_API_TOKEN`; your `.env`                                                                            |
| 14  | KV namespace ID           | `0123456789abcdef0123456789abcdef`                                                     |        | step 8        | `wrangler.jsonc` and `wrangler.directory.jsonc` → `env.production.kv_namespaces[0].id`                                                             |
| 15  | Session secret            | made by `openssl`                                                                      | yes    | step 10       | Cloudflare, site Worker secret `SESSION_SECRET`; nowhere else                                                                                      |
| 16  | Smoke key                 | `kbk_…`                                                                                | yes    | step 11       | GitHub `production-smoke` → secret `CTCDOCS_MACHINE_KEY`                                                                                           |
| 17  | Smoke key record          | `{"name":"smoke",…}`                                                                   |        | step 11       | Cloudflare KV namespace → key `machine-keys`                                                                                                       |
| 18  | Admin group               | `docs-admins@example.com`                                                              |        | step 7        | `site.config.json` → `access.admins` (step 15)                                                                                                     |
| 19  | Platform release commit   | `06d7955f718b06a33568dc7fe52a09127868d8e1`                                             |        | step 12       | every `uses: ctcstack/ctcdocs/…@` line in `.github/workflows/`                                                                                     |

## Step 1. Create the repository

1. Create a **private** repository on GitHub and clone it.
2. In it, create `package.json` and pin pnpm. The pin matters: an older pnpm
   on your machine switches to it by itself.

   ```bash
   pnpm init
   npm pkg set packageManager=pnpm@11.9.0 type=module
   npm pkg set private=true --json
   ```

3. Create `pnpm-workspace.yaml` — pnpm 11 reads its settings from here, not
   from `.npmrc`:

   ```yaml
   allowBuilds:
     esbuild: true
     sharp: true
     workerd: true

   saveExact: true
   engineStrict: true
   strictPeerDependencies: true

   # The platform's releases are installed as soon as they are out; everything
   # else waits out pnpm's minimum release age.
   minimumReleaseAgeExclude:
     - '@ctcstack/*'
   ```

4. Install the platform and the versions its release is tested with. These are
   for release `0.16.0`; for a later one, take the numbers from
   [`fixtures/project/package.json`](https://github.com/ctcstack/ctcdocs/blob/main/fixtures/project/package.json)
   at that release.

   ```bash
   pnpm add @ctcstack/ctcdocs@0.16.0 @ctcstack/ctcdocs-sync@0.16.0 \
     astro@7.3.5 @astrojs/starlight@0.41.5 sharp@0.35.5
   pnpm add -D @astrojs/check@0.9.10 @playwright/test@1.63.0 eslint@10.11.0 \
     prettier@3.9.9 typescript@6.0.3 wrangler@4.142.0
   pnpm exec playwright install chromium
   ```

5. Copy these files from
   [`fixtures/project/`](https://github.com/ctcstack/ctcdocs/tree/main/fixtures/project)
   in the platform repository into yours, unchanged:

   ```text
   eslint.config.js
   prettier.config.mjs
   playwright.ux.config.ts
   tsconfig.json
   .prettierignore
   .gitleaks.toml
   public/robots.txt
   public/_headers
   src/content.config.ts
   src/styles/brand.css
   ```

   Add one line to the end of `.prettierignore`:

   ```text
   pnpm-lock.yaml
   ```

6. Create these files with exactly this content.

   `.node-version`:

   ```text
   22
   ```

   `.gitignore`:

   ```text
   node_modules/
   .astro/
   dist/
   .ctcdocs/
   .wrangler/
   .env
   .dev.vars
   test-results/
   playwright-report/
   ```

   `astro.config.mjs`:

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

   `src/generated/sidebar.ts` and `src/generated/redirects.ts` — placeholders
   the first sync replaces. Keep the first line exactly; it must match
   `sync.generatedBy` in `site.config.json`:

   ```ts
   // AUTO-GENERATED BY EXAMPLE DOCS SYNC. DO NOT EDIT.
   export const generatedSidebar = [];
   ```

   ```ts
   // AUTO-GENERATED BY EXAMPLE DOCS SYNC. DO NOT EDIT.
   export const generatedRedirects = {};
   ```

7. Add your logo as `public/favicon.svg`, and set your accent colors in
   `src/styles/brand.css`.
8. Add these scripts to `package.json`. The platform's workflows call them by
   name:

   ```json
   "scripts": {
     "dev": "astro dev",
     "build": "astro check && astro build",
     "format:check": "prettier --check .",
     "lint": "eslint .",
     "validate": "ctcdocs-sync validate",
     "test:gate": "ctcdocs-verify-gate",
     "test:search": "ctcdocs-verify-search",
     "test:ux": "playwright test --config playwright.ux.config.ts",
     "deploy:dry-run": "wrangler deploy --env production --dry-run && wrangler deploy --config wrangler.directory.jsonc --env production --dry-run",
     "verify": "pnpm format:check && pnpm lint && pnpm validate && pnpm build && pnpm test:gate && pnpm test:search && pnpm test:ux && pnpm deploy:dry-run"
   }
   ```

## Step 2. Write `site.config.json`

Create it with your values (sheet rows 1, 2, 3):

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
      "production": {
        "url": "https://docs.example.com",
        "visibility": "private"
      }
    }
  },
  "home": {
    "lede": "Every document here is published from Google Docs in our Shared Drive and is read-only."
  },
  "navigation": {
    "landingDocumentTitles": ["Overview", "README", "About"],
    "sectionIndexPages": true
  },
  "sync": {
    "generatedBy": "EXAMPLE DOCS SYNC",
    "commitBotName": "example-docs-sync[bot]",
    "defaultLocale": "en"
  }
}
```

`sync.generatedBy` must match the first line of the two placeholder files.
Every other key is explained in [CONFIGURATION.md](CONFIGURATION.md).

## Step 3. Find your Workspace domains (row 3)

In the **Admin console → Account → Domains → Manage domains**, note the primary
domain and every secondary domain your people's addresses use. All of them go
into `signIn.workspaceDomains`. Someone whose address is on a domain you leave
out cannot sign in.

## Step 4. Google: the identity that reads the Drive (rows 4–8)

This identity has no key: GitHub Actions borrows it for each sync.

1. In the Google Cloud console, create a project **inside your Workspace
   organization**. Its ID is row 6. Then:

   ```bash
   gcloud config set project PROJECT_ID
   gcloud projects describe PROJECT_ID --format='value(projectNumber)'
   ```

   The second command prints the project number; you need it below.

2. Turn on the APIs the site uses:

   ```bash
   gcloud services enable drive.googleapis.com docs.googleapis.com \
     iamcredentials.googleapis.com sts.googleapis.com \
     admin.googleapis.com groupssettings.googleapis.com
   ```

3. Create the service account (row 8) and let your repository — and only it —
   use it. Replace `PROJECT_ID`, `PROJECT_NUMBER` and `your-org/docs`:

   ```bash
   gcloud iam service-accounts create docs-sync --display-name="Docs sync (read-only)"

   gcloud iam workload-identity-pools create github \
     --location=global --display-name="GitHub Actions"

   gcloud iam workload-identity-pools providers create-oidc github \
     --location=global --workload-identity-pool=github \
     --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
     --attribute-condition="assertion.repository=='your-org/docs'"

   gcloud iam service-accounts add-iam-policy-binding \
     docs-sync@PROJECT_ID.iam.gserviceaccount.com \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/your-org/docs"
   ```

   Row 7 is
   `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github`.

4. In Google Drive, open the Shared Drive → **Manage members**, add
   `docs-sync@PROJECT_ID.iam.gserviceaccount.com` as **Viewer**. Never more.
5. Open the Shared Drive in the browser: the part of the address after
   `/drive/folders/` is row 4. Open the folder whose contents should become the
   site: the same part of its address is row 5.

## Step 5. Google: the sign-in client (rows 9, 10)

In the same Google Cloud project, open **Google Auth Platform**:

1. **Branding**: an app name people will see, and a support address.
2. **Audience**: choose **Internal**. If Internal is not offered, the project
   is not inside your organization — go back to step 4.1.
3. **Clients → Create client**: type **Web application**. Under **Authorized
   redirect URIs** add `https://docs.example.com/auth/callback` (your row 1).
   Create it.
4. Copy the **Client ID** (row 9) and the **Client secret** (row 10).

## Step 6. Google: the identity that reads group membership (row 11)

The site checks who is in which group every ten minutes, with a second, read-only
identity.

1. Create it and its key. The key is written to your home folder, outside the
   repository, so it can never be committed:

   ```bash
   gcloud iam service-accounts create docs-directory --display-name="Docs directory reader (read-only)"
   gcloud iam service-accounts keys create ~/directory-key.json \
     --iam-account=docs-directory@PROJECT_ID.iam.gserviceaccount.com
   ```

   If Google refuses to create a key, your organization forbids keys by
   default. An organization policy administrator turns off **Disable service
   account key creation** for this one project (**IAM & Admin → Organization
   policies**), then you run the second command again.

2. The **super administrator** opens **Admin console → Account → Admin roles →
   Create new role**, names it `Docs directory reader`, and under **Admin API
   privileges** ticks only **Users → Read** and **Groups → Read**.
3. On that role: **Assign service accounts** → enter
   `docs-directory@PROJECT_ID.iam.gserviceaccount.com` → **Add** → **Assign
   role**.

Do not give this account anything else: no domain-wide delegation, no Drive.

## Step 7. Google: the admin group (row 18)

In the **Admin console → Directory → Groups** (or Google Groups), create a group
such as `docs-admins@example.com` and add the people who manage the site, one
by one. In its settings: **Who can join** — only invited users; **Allow members
outside your organization** — off. Its members will read everything, including
the content health page.

Groups for closing folders (step 15) follow the same rules: people are added
directly, never a group inside a group.

## Step 8. Cloudflare (rows 12, 13, 14)

1. Your domain must already use Cloudflare DNS, and the site address must not
   have a DNS record yet: deploying creates it.
2. **Workers & Pages → Plans**: switch to **Workers Paid**. The free plan's
   daily limit is too small once every request goes through the sign-in.
3. **Your domain → SSL/TLS → Edge Certificates**: turn on **Always Use
   HTTPS**.
4. The account ID (row 12) is on the right of your domain's **Overview** page.
5. **My Profile → API Tokens → Create Token → Edit Cloudflare Workers →
   Use template**. Under **Account Resources** pick your account; under
   **Zone Resources** pick your domain. **Delete the Workers KV Storage line.**
   Create it; the token is row 13.
6. **Storage & databases → Workers KV → Create**: name it
   `example-docs-production-state`. Its ID (row 14) is shown in the list.

## Step 9. Write the two Wrangler files (rows 1, 2, 9, 14)

`wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
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
      "kv_namespaces": [{ "binding": "KB_STATE", "id": "ROW-14" }],
      "vars": { "GOOGLE_CLIENT_ID": "ROW-9" },
    },
  },
}
```

`wrangler.directory.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
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
      "kv_namespaces": [{ "binding": "KB_STATE", "id": "ROW-14" }],
    },
  },
}
```

Check your work, then commit:

```bash
pnpm validate
pnpm build
git add -A && git commit -m "Set up the documentation site" && git push
```

`pnpm validate` names any value that does not match. `pnpm build` must pass
with the placeholders, before any document exists; its warnings that the `docs`
collection is empty are expected until the first sync.

## Step 10. First deploy and the Worker secrets (rows 10, 11, 15)

The automatic deployment checks the live site before it deploys, so the very
first deploy is made from your computer.

1. Create `.env` in the repository (Git ignores it):

   ```text
   CLOUDFLARE_ACCOUNT_ID=ROW-12
   CLOUDFLARE_API_TOKEN=ROW-13
   ```

2. Deploy both Workers:

   ```bash
   pnpm build
   pnpm exec wrangler deploy --config wrangler.directory.jsonc --env production
   pnpm exec wrangler deploy --env production --tag ctcdocs-gate-v1
   ```

   The site now answers, but says sign-in is not configured. That is expected.

3. Put the secrets. The first command asks you to paste row 10:

   ```bash
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
   openssl rand -base64 48 | pnpm exec wrangler secret put SESSION_SECRET --env production
   pnpm exec wrangler secret put DIRECTORY_KEY --config wrangler.directory.jsonc --env production < ~/directory-key.json
   rm ~/directory-key.json
   ```

4. Within ten minutes the directory Worker reads the groups for the first time.
   Watch for `directory-refreshed`:

   ```bash
   pnpm exec wrangler tail example-docs-directory-production
   ```

## Step 11. The smoke key (rows 16, 17)

After every deployment, an automatic check reads the site with this key.

1. Run:

   ```bash
   pnpm exec ctcdocs-machine-key --name smoke --owner you@example.com
   ```

   It prints the key (row 16) once, then a record (row 17).

2. In Cloudflare, open **Workers KV → your namespace → KV Pairs**, add key
   `machine-keys` with the record inside square brackets as its value:

   ```json
   [
     {
       "name": "smoke",
       "owner": "you@example.com",
       "hash": "…",
       "groups": [],
       "expires": "…"
     }
   ]
   ```

3. The key goes to GitHub in the next step. It expires after 90 days; renewing
   it is in [OPERATIONS.md](OPERATIONS.md#machine-keys).

## Step 12. GitHub: environments and workflows (rows 4–8, 12, 13, 16, 19)

1. **Settings → Environments**: create three environments. In each, under
   **Deployment branches**, allow `main` only.

   | Environment         | Variables                                                                                                                                                                                     | Secrets                              |
   | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
   | `production-sync`   | `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_SYNC_SERVICE_ACCOUNT`, `GOOGLE_DRIVE_ID`, `GOOGLE_ROOT_FOLDER_ID`; optionally `GOOGLE_IGNORED_FOLDER_IDS`, comma-separated folder IDs to leave out | `SYNC_FAILURE_WEBHOOK_URL`, optional |
   | `production-deploy` | `CLOUDFLARE_ACCOUNT_ID`                                                                                                                                                                       | `CLOUDFLARE_API_TOKEN`               |
   | `production-smoke`  | none                                                                                                                                                                                          | `CTCDOCS_MACHINE_KEY`                |

2. Find the platform release commit (row 19). For release `v0.16.0`:

   ```bash
   git ls-remote https://github.com/ctcstack/ctcdocs 'refs/tags/v0.16.0*'
   ```

   Take the line ending in `^{}` if there is one, otherwise the only line. The
   long hex string at its start is row 19. It must be the release whose
   packages you installed in step 1.

3. Create these five files, putting row 19 where it says `ROW-19`.

   `.github/workflows/ci.yml`:

   ```yaml
   name: Verification
   on:
     pull_request:
     push:
       branches: [main]
   permissions:
     contents: read
   jobs:
     verify:
       uses: ctcstack/ctcdocs/.github/workflows/project-ci.yml@ROW-19
   ```

   `.github/workflows/sync.yml`:

   ```yaml
   name: Documentation sync
   on:
     schedule:
       - cron: '17 6,18 * * *'
     workflow_dispatch:
       inputs:
         full:
           description: Export every document again
           type: boolean
           default: false
   permissions: {}
   concurrency:
     group: documentation-sync
   jobs:
     sync:
       uses: ctcstack/ctcdocs/.github/workflows/project-sync.yml@ROW-19
       with:
         environment: production-sync
         full: ${{ inputs.full || false }}
         branch: ${{ github.ref_name }}
       secrets: inherit
       permissions:
         contents: write
         id-token: write
     deployment:
       needs: sync
       if: needs.sync.outputs.changed == 'true' && github.ref_name == 'main'
       uses: ctcstack/ctcdocs/.github/workflows/project-deploy.yml@ROW-19
       with:
         wrangler_environment: production
         deploy_environment: production-deploy
         smoke_environment: production-smoke
         candidate_sha: ${{ needs.sync.outputs.candidate_sha }}
         candidate_verified: true
       secrets: inherit
       permissions:
         contents: read
   ```

   `.github/workflows/deploy.yml`:

   ```yaml
   name: Production deployment
   on:
     push:
       branches: [main]
     workflow_dispatch:
   permissions:
     contents: read
   concurrency:
     group: production-deploy
   jobs:
     production:
       uses: ctcstack/ctcdocs/.github/workflows/project-deploy.yml@ROW-19
       with:
         wrangler_environment: production
         deploy_environment: production-deploy
         smoke_environment: production-smoke
       secrets: inherit
   ```

   `.github/workflows/rollback.yml`:

   ```yaml
   name: Production rollback
   on:
     workflow_dispatch:
       inputs:
         version_id:
           description: Cloudflare Worker version ID to restore
           required: true
           type: string
         confirmation:
           description: Type ROLLBACK to confirm
           required: true
           type: string
         restore_older_secrets:
           description: Restore a version whose secrets were rotated since
           type: boolean
           default: false
   permissions:
     contents: read
   concurrency:
     group: production-deploy
   jobs:
     rollback:
       uses: ctcstack/ctcdocs/.github/workflows/project-rollback.yml@ROW-19
       with:
         version_id: ${{ inputs.version_id }}
         confirmation: ${{ inputs.confirmation }}
         restore_older_secrets: ${{ inputs.restore_older_secrets }}
         wrangler_environment: production
         deploy_environment: production-deploy
         smoke_environment: production-smoke
       secrets: inherit
   ```

   `.github/workflows/probe.yml` — checks every two hours that the site lets
   no one in without signing in:

   ```yaml
   name: Anonymous probe
   on:
     schedule:
       - cron: '23 */2 * * *'
     workflow_dispatch:
   permissions:
     contents: read
   jobs:
     probe:
       uses: ctcstack/ctcdocs/.github/workflows/project-probe.yml@ROW-19
   ```

4. Commit and push them.

## Step 13. The first sync

**Actions → Documentation sync → Run workflow**, tick **full**, run. It reads
the Drive, commits the documents to `main`, and deploys them. A green run means
the site is live and the boundary was checked.

## Step 14. Check it yourself

1. Open the site in a private window. You are sent to Google.
2. Sign in with a Workspace account: you see the home page. A personal Gmail
   account is refused by Google.
3. Open a document, search for a word in it, and use **Sign out** in the header.

From now on the site updates itself at 06:17 and 18:17 UTC, and after every
push to `main`.

## Step 15. Close folders to some groups (optional)

Without this step, everyone who can sign in reads everything.

1. For each folder to close, note its ID (the part of its Drive address after
   `/drive/folders/`) and the groups that may read it. Create those groups as
   in step 7.
2. Add an `access` section to `site.config.json`:

   ```json
   "access": {
     "admins": ["docs-admins@example.com"],
     "rules": [
       { "folder": "ROW-5", "label": "Everything", "readers": ["*"] },
       {
         "folder": "FINANCE-FOLDER-ID",
         "label": "Finance",
         "readers": ["finance@example.com"]
       }
     ]
   }
   ```

   `"*"` means everyone who can sign in. A folder with no rule on it or above
   it is closed to everyone except the admin group — so the first rule, on the
   root folder (row 5), opens everything a narrower rule does not close.
   `label` is the folder's name, for you; the site warns when it no longer
   matches.

3. Commit and push. The deployment applies it; group membership changes take
   effect within about ten minutes.

[CONFIGURATION.md](CONFIGURATION.md#who-may-read-which-folder) has the full
rules.

## Step 16. Let AI assistants read the site (optional)

People can then read the site from claude.ai, ChatGPT, Claude Code, Cursor and
other assistants, each seeing what they may open here.

1. Add `"mcp": { "enabled": true }` to `site.config.json`.
2. In Cloudflare, create the OAuth namespace, the documents bucket, the
   account's AI Search service token once, and the AI Search instance, and add
   their bindings, the compatibility flag and the cron to `wrangler.jsonc`, as
   [Cloudflare setup](CLOUDFLARE_SETUP.md#the-mcp-server) shows.
3. Commit and push. Within five minutes of the deploy the Worker publishes the
   documents and starts the first index.
4. Connect an assistant to `https://<host>/mcp`, as
   [Operations](OPERATIONS.md#connecting-an-assistant) describes, and ask it
   something the site answers.

## Moving an existing site off Cloudflare Access

If the site already runs behind a Cloudflare Access application, do not detach
Access first. In this order:

1. Do steps 3, 5, 6, 7, 8 (points 2, 3, 5, 6) and 9 of this page. Skip the
   first deploy in step 10: the Workers already exist.
2. Put the three secrets of step 10.3 — for `DIRECTORY_KEY`, Wrangler offers to
   create the directory Worker; accept — and add the smoke key of step 11. In
   `production-smoke`, add `CTCDOCS_MACHINE_KEY` and **keep**
   `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` for now.
3. Upgrade the platform packages and the workflow pins to the new release,
   with `signIn` and the two Wrangler files, and merge. The deployment runs
   with Access still in front: you sign in twice for a while, to Access and to
   Google.
4. Wait for `directory-refreshed` (step 10.4), then check step 14.
5. In Cloudflare **Zero Trust → Access → Applications**, delete the
   application; delete its service token; delete `CF_ACCESS_CLIENT_ID` and
   `CF_ACCESS_CLIENT_SECRET` from `production-smoke`.
6. **Actions → Production deployment → Run workflow**: this run proves the site
   with the Worker alone.

## A public site instead

For documentation anyone may read, set `"visibility": "public"` in step 2, leave
out `signIn`, and skip steps 3, 5, 6, 7, 10.3–10.4, 11 and 15, and the probe.
`wrangler.jsonc` then has no `main`, `alias`, `binding`, `run_worker_first`,
`kv_namespaces` or `vars`; there is no `wrangler.directory.jsonc`, and
`deploy:dry-run` runs only the first command. In `public/robots.txt` and
`public/_headers`, follow the public column of
[CONFIGURATION.md](CONFIGURATION.md#who-may-read-the-deployment).

## When something goes wrong

| What you see                                                 | What to do                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate` names a value                                | Make that value the same in `site.config.json` and the Wrangler files                                                                                                                         |
| A pnpm command says `packages field missing or empty`        | `package.json` has no `packageManager` pin, so an older pnpm runs: step 1.2                                                                                                                   |
| pnpm installs an older platform version than you asked for   | `minimumReleaseAgeExclude` is missing from `pnpm-workspace.yaml`: step 1.3                                                                                                                    |
| The build cannot find `src/generated/sidebar.ts`             | The placeholder files of step 1.6 are missing                                                                                                                                                 |
| Validation says a generated file is missing its marker       | The first line of the placeholders does not match `sync.generatedBy`                                                                                                                          |
| Images fail to build                                         | `pnpm-workspace.yaml` is missing `allowBuilds`: step 1.3                                                                                                                                      |
| The format check fails on `pnpm-lock.yaml`                   | Add it to `.prettierignore`: step 1.5                                                                                                                                                         |
| Validation objects to `.ctcdocs/`                            | Add `.ctcdocs/` to `.gitignore`                                                                                                                                                               |
| The site says sign-in is not configured                      | A secret of step 10.3 is missing, or row 9 is not in `wrangler.jsonc`                                                                                                                         |
| The site says the directory has not been read yet            | Wait ten minutes; if it stays, read `wrangler tail` of the directory Worker: usually step 6.2–6.3 or `DIRECTORY_KEY`                                                                          |
| Google says the app is for your organization only            | You used an account outside the organization: that is the point                                                                                                                               |
| Google says `redirect_uri_mismatch`                          | The redirect URI in step 5.3 is not exactly `https://` + row 1 + `/auth/callback`                                                                                                             |
| Sign-in did not work: "failed its checks: Workspace domain"  | Your address's domain is missing from row 3                                                                                                                                                   |
| Signed in, but told your account is not in the directory     | The account is new, or was suspended: wait ten minutes, then check the directory Worker's logs                                                                                                |
| The sync fails at authentication                             | Rows 6–8 in `production-sync`, or the repository name in step 4.3                                                                                                                             |
| The sync fails reading the Drive                             | The service account of step 4.4 is not a member of the Shared Drive; if Drive refused to add it, your Workspace blocks sharing outside the organization — an admin allows it for that address |
| The deployment fails before deploying, at the boundary check | `CTCDOCS_MACHINE_KEY` in `production-smoke` does not match the record in `machine-keys`, or the key expired                                                                                   |
| A deployment says a workflow script is missing               | A script of step 1.8 is missing from `package.json`                                                                                                                                           |

Day-to-day running — renewing keys, rotating secrets, rollback, what the
reports mean — is in [OPERATIONS.md](OPERATIONS.md).
