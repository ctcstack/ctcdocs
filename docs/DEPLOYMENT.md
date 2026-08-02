# Development and production deployment

This runbook is the canonical end-to-end deployment procedure for the wiki.
It covers initial infrastructure bootstrap, GitHub configuration, normal
development and production releases, verification, and rollback.

## Deployment topology

| Environment | Worker                     | Protected hostname             | Deployment trigger                                      |
| ----------- | -------------------------- | ------------------------------ | ------------------------------------------------------- |
| Development | `example-docs-development` | `https://docs-dev.example.com` | Manual; optional automatic promotion from `main`        |
| Production  | `example-docs-production`  | `https://docs.example.com`     | Push to `main`, changed sync output, or manual dispatch |

The Worker name and both hostnames are declared once in
`site.config.json` and mirrored in `wrangler.jsonc`;
`ctcdocs-sync validate` fails if the two disagree. Setting this platform up for
another project starts there — see [Configuration](CONFIGURATION.md).

Both targets use Cloudflare Workers Static Assets. Both disable `workers.dev`
and version preview URLs. Both must be protected by Cloudflare Access before
they can contain internal content.

Local `pnpm dev` is not the remote development deployment. It is an
unauthenticated loopback-only Astro server intended for synthetic content.

## Security model

The release sequence is:

```text
exact main commit
→ canonical verification
→ optional protected development deployment and smoke test
→ protected production deployment
→ production smoke test
```

Development and production use separate Workers, hostnames, deploy tokens,
Access service tokens, GitHub environments, and deployment histories. A
production deployment never reads Google Drive. It deploys only the generated
content already committed in the exact `main` revision.

Never deploy internal content if:

- the target does not have an Access application;
- an anonymous request can reach HTML or a static asset;
- `workers.dev` or a version preview URL is enabled;
- the build contains unreviewed local generated changes;
- the source revision is not an exact commit on `main`.

## One-time Cloudflare setup

Complete the Access configuration before creating each custom-domain Worker
binding.

### 1. Create the development Access application

1. Open **Cloudflare Dashboard → Zero Trust → Access controls →
   Applications**.
2. Select **Add an application → Self-hosted and private → Add public
   hostname**.
3. Configure:

   ```text
   Application name: Example Docs Development
   Domain: example.com
   Subdomain: docs-dev
   Path: leave empty so the whole hostname is protected
   Session duration: 24 hours
   ```

4. Add the employee policy:

   ```text
   Action: Allow
   Include: Login Methods = CTCStack Google Workspace
   ```

5. Accept only the configured CTCStack Google Workspace identity provider.
6. Do not add `Everyone`, One-time PIN, email-domain matching, or a `Bypass
Everyone` policy.
7. Save the application.

The production application must apply the same rules to
`docs.example.com`.

### 2. Create separate smoke-test service tokens

For each environment:

1. Open **Zero Trust → Access controls → Service credentials → Service
   Tokens**.
2. Create a token named `CTCStack Wiki Development Smoke` or `CTCStack Wiki
Production Smoke`.
3. Copy its Client ID and Client Secret once into the appropriate password
   manager entry.
4. Return to the matching Access application and add:

   ```text
   Action: Service Auth
   Include: Service Token = <matching smoke token>
   ```

5. Never put either value in repository variables, workflow YAML, Wrangler
   configuration, command-line arguments, or documentation.

Do not reuse one smoke token across development and production. The two tokens
must be independently revocable and auditable.

### 3. Create separate deploy API tokens

Create one token for development and one for production:

1. Open **Cloudflare Dashboard → My Profile → API Tokens → Create Token**.
2. Start with **Edit Cloudflare Workers**.
3. Restrict account resources to the project's Cloudflare account.
4. Restrict zone resources to the project's zone.
5. Keep only the permissions required to upload Workers and manage the
   committed custom-domain binding.
6. Do not grant Access Apps and Policies, Access Service Tokens, broad DNS
   administration, user administration, billing, or unrelated account access.
7. Store each token in the matching GitHub deployment environment.

Cloudflare API token resource scopes do not replace repository controls.
GitHub environment branch rules and the explicit Wrangler environment are also
required.

### 4. Bootstrap the development custom domain

The normal workflow runs an Access preflight before deployment. A brand-new
hostname cannot pass that preflight until its first Worker custom-domain
binding exists. Bootstrap it exactly once with synthetic, non-sensitive
content:

1. Confirm the development Access application and both policies already exist.
2. Check out the reviewed repository revision and confirm the generated
   content is synthetic or otherwise approved for the bootstrap.
3. Add the development Cloudflare account ID and deploy token to the ignored
   `apps/wiki/.env`, which Wrangler loads from its package directory. Do not
   use the production token.
4. Run:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   pnpm deploy:development
   ```

5. Immediately verify anonymous denial:

   ```bash
   curl --head https://docs-dev.example.com/
   ```

   A redirect to the Access login flow or an Access denial is expected. A
   direct `200` wiki response is a security failure.

6. Put the development hostname and development smoke token in the ignored
   repository-root `.env`, which the smoke scripts load, then run:

   ```bash
   pnpm test:access:preflight
   pnpm test:access:post-deploy
   ```

7. In the Worker settings, confirm `workers.dev` and Preview URLs are disabled.

Do not use this bootstrap exception for production or for real internal
content. Production already requires a working Access preflight before every
deployment.

## One-time GitHub setup

Local `.env` values are never read by GitHub Actions. They must be copied to
GitHub environment variables or secrets through the GitHub UI.

Open **Repository → Settings → Environments**. Create the environments below.
For every environment, restrict deployment branches to `main`. Add required
reviewers when the repository plan supports them; production should require a
reviewer distinct from the person initiating the deployment where possible.

### `development-deploy`

Environment variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Environment secret:

```text
CLOUDFLARE_API_TOKEN
```

Use the development deploy token.

### `development-smoke`

Environment variable:

```text
CTCDOCS_BASE_URL=https://docs-dev.example.com
```

Environment secrets:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Use the development smoke token.

### `production-deploy`

Environment variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Environment secret:

```text
CLOUDFLARE_API_TOKEN
```

Use the production deploy token.

### `production-smoke`

Environment variable:

```text
CTCDOCS_BASE_URL=https://docs.example.com
```

Environment secrets:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Use the production smoke token.

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

Do not copy the test Shared Drive IDs into `production-sync`. The protected
`test-drive` environment remains dedicated to integration testing.

## Optional automatic development promotion

Automatic development promotion in the production workflow is disabled by
default to avoid spending runner time while no release task depends on it. The
standalone **Development deployment** workflow remains available for an
explicit manual run from `main`.

To restore development as an automatic production gate, create this repository
Actions variable:

```text
ENABLE_DEVELOPMENT_DEPLOYMENT=true
```

Delete the variable or set it to any value other than the exact lowercase
string `true` to disable the gate again. When enabled, a failed development
verification, deployment, or protected smoke test blocks production.

## Deploy to development

The development workflow deploys the exact current `main` commit. It cannot be
run from a feature branch.

1. Ensure the intended change has been reviewed and merged to `main`.
2. Open **GitHub → Actions → Development deployment**.
3. Select **Run workflow**.
4. Choose branch `main`.
5. Select **Run workflow**.
6. Confirm all jobs pass:

   ```text
   Verify development candidate
   Verify development Access before deployment
   Deploy immutable development assets
   Verify protected development
   ```

7. Open `https://docs-dev.example.com` in an incognito window and sign in
   through the CTCStack Google Workspace provider.
8. Check navigation, search, images, tables, one missing route, and any changed
   pages.
9. Review the workflow summary and confirm the deployed commit SHA.

This workflow is useful for an explicit re-deployment or a development-only
validation. The production workflow calls it automatically only when
`ENABLE_DEVELOPMENT_DEPLOYMENT=true` and then waits for its protected smoke
test before production can proceed.

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
   Verify production candidate
   Verify Access before deployment
   Deploy immutable static assets
   Verify protected production
   Require completed production deployment
   ```

   The final gate fails when either deployment or the protected smoke test is
   skipped. A green workflow therefore guarantees that the verified commit was
   actually deployed and exercised through Cloudflare Access.

For a manual re-deployment of the current `main` revision:

1. Open **GitHub → Actions → Production deployment**.
2. Select **Run workflow**.
3. Choose branch `main`.
4. Select **Run workflow**.

After either path:

1. Open `https://docs.example.com` in an incognito window.
2. Confirm the only login option is the CTCStack Google Workspace provider.
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
pnpm deploy:dry-run:development
pnpm deploy:dry-run:production
```

Normal releases should use GitHub Actions. Direct local production deployment
is reserved for an approved incident procedure:

```bash
pnpm test:access:preflight
pnpm deploy:production
pnpm test:access:post-deploy
```

For a direct local operation, Wrangler reads deploy credentials from the
ignored `apps/wiki/.env`, while the smoke scripts read the target and Access
credentials from the ignored repository-root `.env`. Both files must describe
the same environment. Never paste tokens directly into shell commands.

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

If Access itself is failing, stop deployments and follow the security incident
procedure in [Operations](OPERATIONS.md) instead of rolling application code.

## Troubleshooting

### Smoke variables are blank

Typical log:

```text
CTCDOCS_BASE_URL:
CF_ACCESS_CLIENT_ID:
CF_ACCESS_CLIENT_SECRET:
```

Cause: the values exist only in local `.env`, or were added to a different
GitHub environment.

Fix: add the URL as an environment variable and the two credentials as
environment secrets in the exact `development-smoke` or `production-smoke`
environment, then re-run the workflow.

### `production-deploy` does not exist

Create the environment under **Settings → Environments**, add the account ID
variable and deploy-token secret, restrict it to `main`, and re-run the
production workflow.

### Sync reports a missing variable

Typical log:

```text
Missing production-sync variable: GCP_PROJECT_ID
```

Populate all required `production-sync` environment variables. Local `.env`
and `test-drive` variables do not flow into `production-sync`.

### Custom domain already belongs to another Worker

Keep the Access application enabled. Remove only the obsolete Worker
custom-domain binding, deploy the intended named environment immediately, run
the protected smoke test, and delete the old Worker only after successful
verification.

### Anonymous request returns wiki content

Treat this as a security incident:

1. stop sync and deployment workflows;
2. disable the public route or Worker;
3. restore the Access application and policies;
4. revoke affected tokens;
5. inspect Cloudflare and GitHub audit logs;
6. re-enable deployment only after the anonymous negative check passes.

## Official references

- [Cloudflare Workers environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
