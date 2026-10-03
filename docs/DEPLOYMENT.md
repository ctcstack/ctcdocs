# Development and production deployment

This runbook is the canonical end-to-end deployment procedure for the wiki.
It covers initial infrastructure bootstrap, GitHub configuration, normal
development and production releases, verification, and rollback.

## Deployment topology

| Environment | Worker                     | Protected hostname             | Deployment trigger                                      |
| ----------- | -------------------------- | ------------------------------ | ------------------------------------------------------- |
| Development | `example-docs-development` | `https://docs-dev.example.com` | Whatever the project's workflow calls it with           |
| Production  | `example-docs-production`  | `https://docs.example.com`     | Push to `main`, changed sync output, or manual dispatch |

The Worker name and both hostnames are declared once in
`site.config.json` and mirrored in `wrangler.jsonc`;
`ctcdocs-sync validate` fails if the two disagree. Setting this platform up for
another project starts there — see [Configuration](CONFIGURATION.md).

Both targets use Cloudflare Workers Static Assets, and both disable
`workers.dev` and version preview URLs. A private target is served through the
platform's Worker, which signs readers in with Google and serves each file only
to the readers its access class names, and each private environment has a
directory Worker beside it that keeps the snapshot of group membership. See
[Cloudflare setup](CLOUDFLARE_SETUP.md).

Local `pnpm dev` is not the remote development deployment. It is an
unauthenticated loopback-only Astro server intended for synthetic content.

## Security model

The release sequence is:

```text
exact main commit
→ canonical verification and the denial suite
→ optional protected development deployment and smoke test
→ protected production deployment
→ production smoke test
```

Development and production use separate Workers, hostnames, KV namespaces,
deploy tokens, session secrets, machine keys, GitHub environments, and
deployment histories. A production deployment never reads Google Drive. It
deploys only the generated content already committed in the exact `main`
revision.

Never deploy internal content if:

- `ctcdocs-sync validate` or `ctcdocs-verify-gate` fails;
- an anonymous request can reach HTML or a static asset;
- `workers.dev` or a version preview URL is enabled;
- the build contains unreviewed local generated changes;
- the source revision is not an exact commit on `main`.

## One-time setup

Each private environment needs, once:

1. **The sign-in client and the directory reader** in Google, following
   [Google Workspace setup](GOOGLE_WORKSPACE_SETUP.md#sign-in). One client can
   serve every environment, with one redirect URI each.
2. **A KV namespace**, its ID in both `wrangler.jsonc` and
   `wrangler.directory.jsonc`, following
   [Cloudflare setup](CLOUDFLARE_SETUP.md#the-kv-namespace).
3. **A deploy API token** without KV permissions, following
   [Cloudflare setup](CLOUDFLARE_SETUP.md#deploy-api-token). Do not reuse one
   token across environments.
4. **A smoke machine key**, issued with `ctcdocs-machine-key` and recorded in
   that environment's `MACHINE_KEYS` secret, following
   [Cloudflare setup](CLOUDFLARE_SETUP.md#machine-keys). Do not reuse one key
   across environments: each must be revocable on its own.

Cloudflare API token resource scopes do not replace repository controls.
GitHub environment branch rules and the explicit Wrangler environment are also
required.

### Bootstrap a new hostname

The deployment workflow probes the hostname before it deploys, and a hostname
that has never been deployed to cannot answer. Bootstrap each new environment
once, from a reviewed revision whose generated content is synthetic or
otherwise approved:

1. Put that environment's Cloudflare account ID and deploy token in the ignored
   `.env` beside `wrangler.jsonc`, which is where Wrangler loads it from.
2. Build and deploy both Workers:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm exec wrangler deploy --config wrangler.directory.jsonc --env development
   pnpm exec wrangler deploy --env development
   ```

   With no secrets yet, the site Worker admits no one and says sign-in is not
   configured. That is the safe state to start from.

3. Put the secrets — `DIRECTORY_KEY` on the directory Worker;
   `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and `MACHINE_KEYS` on the site
   Worker — and wait for the first refresh:

   ```bash
   pnpm exec wrangler tail example-docs-directory-development
   ```

   shows `directory-refreshed` within ten minutes. Until then the site says the
   directory has not been read yet.

4. Verify anonymous denial:

   ```bash
   curl --head https://docs-dev.example.com/
   ```

   `401` is expected. A `200` with wiki content is a security failure.

5. Put the hostname and the smoke key in the ignored repository-root `.env`,
   which the smoke scripts load, then run:

   ```bash
   pnpm exec ctcdocs-access-smoke --preflight
   pnpm exec ctcdocs-access-smoke --post-deploy
   ```

6. Sign in in a browser, and check `/_kb/status` as a member of an admin group.
7. In the Worker settings, confirm `workers.dev` and Preview URLs are disabled
   for both Workers.

A deployment that stood behind Cloudflare Access moves off it in the order
[Cloudflare setup](CLOUDFLARE_SETUP.md#moving-a-deployment-off-cloudflare-access)
gives, never by detaching Access first.

## One-time GitHub setup

Local `.env` values are never read by GitHub Actions. They must be copied to
GitHub environment variables or secrets through the GitHub UI.

Open **Repository → Settings → Environments**. Create the environments below.
For every environment, restrict deployment branches to `main`. Add required
reviewers when the repository plan supports them; production should require a
reviewer distinct from the person initiating the deployment where possible.

### `development-deploy` and `production-deploy`

Environment variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Environment secret:

```text
CLOUDFLARE_API_TOKEN
```

Use the matching environment's deploy token.

### `development-smoke` and `production-smoke`

Environment variable:

```text
CTCDOCS_BASE_URL=https://docs.example.com
```

Environment secret:

```text
CTCDOCS_MACHINE_KEY
```

Use the matching environment's smoke key. While a deployment still stands
behind Cloudflare Access, `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`
sit beside it; the smoke test sends both.

### `production-sync`

The sync environment is not required to deploy the current committed content,
but it is required for Drive-to-Git automation.

Environment variables:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_SYNC_SERVICE_ACCOUNT
GOOGLE_DRIVE_ID
GOOGLE_ROOT_FOLDER_ID
GOOGLE_IGNORED_FOLDER_IDS
```

`GOOGLE_IGNORED_FOLDER_IDS` may be empty. The other values must be populated.
The identity must have read-only access to the production Shared Drive scope.

Optional environment secret:

```text
SYNC_FAILURE_WEBHOOK_URL
```

Never point a test Shared Drive and a production one at the same environment.
Separate identities, separate environments.

## Environments are a project's choice

`project-deploy.yml` deploys one environment per call, and takes the three names
it needs as inputs:

```yaml
jobs:
  production:
    uses: ctcstack/ctcdocs/.github/workflows/project-deploy.yml@<commit sha>
    with:
      wrangler_environment: production
      deploy_environment: production-deploy
      smoke_environment: production-smoke
    secrets: inherit
```

A project that publishes production only calls it once. A project that promotes
through a development host calls it twice and makes the second job `needs:` the
first, which is what turns development into a gate: a failed development
deployment or a failed protected smoke test then blocks production.

The platform has no opinion about how many environments there are, beyond
requiring `production` to exist. Whatever `site.config.json` declares,
`wrangler.jsonc` must match, and `ctcdocs-sync validate` fails when they
disagree.

The workflow deploys the site Worker and, when `wrangler.directory.jsonc`
exists, the directory Worker, from the same build and therefore with the same
access map. A private environment's versions are tagged `ctcdocs-gate-v1`.

## The anonymous probe

`project-probe.yml` asks production, with no credentials, for a page, a
Markdown file, the agent index and the search runtime, and fails when any is
admitted. It reads no secret. Call it on a schedule of the project's own, so a
boundary that disappears between deployments is noticed:

```yaml
on:
  schedule:
    - cron: '23 */2 * * *'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  probe:
    uses: ctcstack/ctcdocs/.github/workflows/project-probe.yml@<commit sha>
```

## Deploy to a development environment

The workflow deploys an exact commit, defaulting to the one that triggered it.

1. Ensure the change has been reviewed and merged.
2. Open **GitHub → Actions**, choose the workflow that calls
   `project-deploy.yml` for development, and run it.
3. Confirm every job passes: the corpus guard, the candidate verification, the
   boundary check, the deployment, and the post-deploy check.
4. Open the development hostname in a private window and confirm the access
   boundary behaves as the environment's `visibility` declares.
5. Check navigation, search, images, tables, one missing route, and any changed
   pages.
6. Review the workflow summary and confirm the deployed commit SHA.

## Deploy to production

Every push to `main` starts **Production deployment**. A sync that commits
changed generated output invokes the same reusable workflow with that exact
commit SHA. Automatic development promotion is skipped unless explicitly
enabled by the repository variable described above.

For an automatic deployment:

1. Merge the approved pull request to `main`.
2. Open **GitHub → Actions → Production deployment**.
3. Confirm the run is associated with the merge commit.
4. If automatic development promotion is enabled, confirm its reusable
   workflow succeeds; otherwise confirm that job is skipped.
5. Approve the production GitHub environment if an approval rule is enabled.
6. Confirm these production jobs pass:

   ```text
   Verify the deployment candidate
   Verify the boundary before deployment
   Deploy immutable static assets
   Verify the protected deployment
   Require a completed deployment
   ```

   The candidate verification — the project's gate, then the denial suite —
   and the boundary check run side by side, and the deployment waits for both.
   The final gate fails when either deployment or the protected smoke test is
   skipped. A green workflow therefore guarantees that the verified commit was
   actually deployed and exercised through its boundary.

A deployment started by a sync shows the candidate verification as skipped,
not passed. The sync job ran `pnpm verify` and the denial suite on the exact
tree it committed, and its caller passes `candidate_verified: true` with
`candidate_sha`, so the gate does not run a second time. The input is refused
without a SHA, and any other reason for verification to be skipped still stops
the deployment.

For a manual re-deployment of the current `main` revision:

1. Open **GitHub → Actions → Production deployment**.
2. Select **Run workflow**.
3. Choose branch `main`.
4. Select **Run workflow**.

After either path:

1. Open `https://docs.example.com` in a private window.
2. Confirm it sends you to Google, and that a personal account is refused.
3. Verify the home page, navigation, Pagefind search, images, tables, and a
   missing route.
4. Confirm an anonymous request to the home page and a Pagefind asset does not
   return content directly.
5. In Cloudflare, confirm the deployment is on `example-docs-production`, the
   custom domain is correct, and no `workers.dev` or Preview URL exists.

## Optional local dry-run

Local validation does not upload anything:

```bash
corepack enable
pnpm install --frozen-lockfile
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium
pnpm verify
pnpm exec ctcdocs-verify-gate
pnpm deploy:dry-run
```

Normal releases should use GitHub Actions. Direct local production deployment
is reserved for an approved incident procedure:

```bash
pnpm exec ctcdocs-access-smoke --preflight
pnpm exec wrangler deploy --env production --tag ctcdocs-gate-v1
pnpm exec wrangler deploy --config wrangler.directory.jsonc --env production
pnpm exec ctcdocs-access-smoke --post-deploy
```

For a direct local operation, Wrangler reads deploy credentials from the
ignored `.env` beside `wrangler.jsonc`, while the smoke test reads the target
and the machine key from the project root `.env`. Both must describe the same
environment. Never paste tokens directly into shell commands.

## Rollback production

1. Open **Cloudflare → Workers & Pages → `example-docs-production` →
   Deployments**.
2. Copy the version ID of a previously smoke-tested deployment.
3. Open **GitHub → Actions → Production rollback**.
4. Select **Run workflow** on `main`.
5. Enter the version ID.
6. Enter `ROLLBACK` in the confirmation field.
7. Approve the production environment gate if configured.
8. Wait for the post-rollback protected smoke test.
9. Record the incident, restored version, root cause, and follow-up fix.

A private deployment's rollback refuses a version without the
`ctcdocs-gate-v1` tag: such a version predates the Worker and would serve
everything to everyone. A rollback restores the site Worker with its own
access map; the directory Worker keeps reading the groups of the latest build,
so a group only the older map names admits no one until the next deployment.

If the boundary itself is failing, stop deployments and follow the security
incident procedure in [Operations](OPERATIONS.md) instead of rolling
application code.

## Troubleshooting

### Smoke variables are blank

Typical log:

```text
A machine key (CTCDOCS_MACHINE_KEY) or Cloudflare Access service-token credentials are required.
```

Cause: the values exist only in local `.env`, or were added to a different
GitHub environment.

Fix: add the URL as an environment variable and the key as an environment
secret in the exact `development-smoke` or `production-smoke` environment, then
re-run the workflow.

### The smoke key is refused

The key is not in that environment's `MACHINE_KEYS`, the record was pasted
into the other environment, or it has expired. Issue a new one and replace
both the record and `CTCDOCS_MACHINE_KEY`; see
[Operations](OPERATIONS.md#machine-keys).

### The site says the directory has not been read yet

There is no snapshot in the environment's namespace: the directory Worker has
not run, or every run has failed. Its logs say why; see
[Operations](OPERATIONS.md#the-directory-snapshot).

### `production-deploy` does not exist

Create the environment under **Settings → Environments**, add the account ID
variable and deploy-token secret, restrict it to `main`, and re-run the
production workflow.

### Sync reports a missing variable

Typical log:

```text
Missing production-sync variable: GCP_PROJECT_ID
```

Populate all required `production-sync` environment variables. A local `.env`
and any test-corpus environment do not flow into it.

### Custom domain already belongs to another Worker

Remove only the obsolete Worker's custom-domain binding, deploy the intended
named environment immediately, run the protected smoke test, and delete the
old Worker only after successful verification.

### Anonymous request returns wiki content

Treat this as a security incident and follow
[Operations](OPERATIONS.md#rollback): take the custom domain off the Worker
first, then find the cause.

## Official references

- [Cloudflare Workers environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers versions and rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
