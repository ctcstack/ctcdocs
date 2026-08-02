# Operations runbook

## Release flow

The content and release paths are intentionally separated:

```text
Google Drive
→ Knowledge Base sync
→ allowlisted generated commit on main
→ optional protected development deployment and smoke test
→ production deployment and smoke test
```

When generated output changes, the sync workflow passes the exact committed
SHA to the reusable production deployment workflow. The deployment workflow
never reads Google Drive. A failed sync, verification, Access preflight,
build, deployment, or post-deploy smoke leaves the previous generated commit
or Worker version available for recovery.

Automatic promotion through development is disabled by default. Set the
repository Actions variable `ENABLE_DEVELOPMENT_DEPLOYMENT=true` to restore it
as a production gate. The standalone development workflow remains available
for manual runs from `main`.

## GitHub environments

Create these protected GitHub Environments before enabling the workflows.
Restrict deployment branches to `main`, add required reviewers where the
current GitHub plan supports them, and do not copy a credential between
environments.

### `development-deploy`

Variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Secret:

```text
CLOUDFLARE_API_TOKEN
```

Use a development-only deploy token.

### `development-smoke`

Variable:

```text
CTCDOCS_BASE_URL=https://docs-dev.example.com
```

Secrets:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Use a development-only Access service token.

### `production-sync`

Variables:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_SYNC_SERVICE_ACCOUNT
GOOGLE_DRIVE_ID
GOOGLE_ROOT_FOLDER_ID
GOOGLE_IGNORED_FOLDER_IDS
```

Optional secret:

```text
SYNC_FAILURE_WEBHOOK_URL
```

The Google identity must have read-only Drive access. The workflow obtains a
short-lived `drive.readonly` access token through GitHub OIDC and Workload
Identity Federation.

### `production-deploy`

Variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Secret:

```text
CLOUDFLARE_API_TOKEN
```

Scope the token to the project's account and project's zone. It may deploy
the `example-docs-production` Worker and manage its configured custom-domain
binding, but it must not manage Access identities, service tokens, unrelated
Workers, broad DNS administration, or account settings.

### `production-smoke`

Variable:

```text
CTCDOCS_BASE_URL=https://docs.example.com
```

Secrets:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

This service token needs only a Cloudflare Access `Service Auth` policy for the
wiki application. It does not need Cloudflare API access.

## Scheduled and manual sync

`.github/workflows/sync.yml` runs twice daily at 06:17 and 18:17 UTC and
supports a manual `workflow_dispatch`. The offset from the start of the hour
reduces exposure to peak GitHub Actions scheduling load. Scheduled execution
is best-effort; use the manual workflow when a content update is time-sensitive.

Normal manual sync:

1. Open **Actions → Knowledge Base sync**.
2. Select **Run workflow** on `main`.
3. Leave **Export every managed Google Doc** disabled.
4. Review the aggregate job summary and generated commit.

Full regeneration:

1. Run the same workflow.
2. Enable **Export every managed Google Doc**.
3. Confirm the generated diff contains only allowlisted paths.
4. Confirm the production deployment and protected smoke job succeed.

The sync job checks out `main`, writes through the atomic output writer, checks
the complete working-tree diff against the shared generated-path allowlist,
runs `pnpm verify`, stages only generated paths, and pushes without force. A
concurrent human merge causes a safe non-fast-forward failure; the next run
starts from the new `main`.

No-op syncs create no commit. A successful content commit uses:

```text
chore(kb): sync Google Drive content
```

## Local read-only diagnostics

Run the safe preview before any local write:

```bash
pnpm sync:dry-run
```

Inventory-only integration should normally use the protected **Google WIF
smoke test** workflow:

```text
Google Drive inventory dry-run passed.
Items visible: <count>
Folders selected: <count>
Google Docs selected: <count>
Unsupported items selected: <count>
Ignored items: <count>
Warnings: <count>
  <warning code>: <count>
```

Investigate unexpected count reductions, graph warnings, authentication or
permission errors, and exhausted retry budgets before synchronizing. Never
print the JSON inventory or document bodies into production Actions logs.

## Ordering the wiki from Drive

The sidebar, and with it the previous and next links, follows the order the
Drive names declare. Nothing in this repository has to change to reorder the
wiki. The rule is recorded in
[ADR-013](ADR/013-editorial-navigation-order.md); operationally it reads:

1. A folder's landing document comes first — the titles in
   `navigation.landingDocumentTitles`, matched without regard to case.
2. Then the numbered items, ascending.
3. Then everything else, alphabetically.

A number is one to three digits, followed by `-`, `–`, `—`, or `.`, or wrapped
in square brackets. A space alone is not a separator, so a name opening with a
year or a quantity keeps it.

```text
01 — Company     ordered      2024 Annual Report   not ordered
1 - Overview     ordered      01 Company           not ordered
02. Products     ordered
[003] Playbooks  ordered
```

The number never reaches the page: it is stripped from the sidebar label, the
heading, and the URL. Renumbering therefore breaks no links and creates no
redirect. Renumbering a folder rearranges navigation only; renumbering a
document re-exports that one document.

Numbering in steps of ten leaves room to insert without touching the
neighbours.

Three arrangements leave the order undefined and are reported as sync warnings:
two siblings claiming the same number, two landing documents in one folder, and
a name opening with digits and a space in a folder already using the
convention. `pnpm sync:inventory` counts them by code; adding `--json` names
the item behind each one.

## Linking to a section

Every folder below the publication root has an address of its own,
`/<folder-slug>/`, derived from the folder path the same way a document slug
is. The address is reserved whether or not a page is served at it, so it never
changes when the switch below is flipped.

With `navigation.sectionIndexPages` enabled, that address serves a generated
page: the folder's name and a listing of its subfolders and documents in the
same order the sidebar uses, each with the description it publishes. A folder
with nothing in it still gets its page and says so.

The page is deliberately absent from the sidebar and from search. It is reached
by its URL, by the folder cards on the home page, and by the breadcrumb above
every document in it. Where a folder has no page, those two fall back to the
folder's heading in the home index, which is how they behaved before. Renaming
a folder does not move the address — the manifest owns it exactly as it owns a
document slug.

An overview document is not this page. It keeps its own address and appears in
the listing like any other document. See
[ADR-014](ADR/014-section-index-pages.md).

## Content lifecycle operations

Re-export one managed document locally:

```bash
pnpm sync --file <google-file-id>
```

Intentionally allocate a new slug and preserve the old URL as a redirect:

```bash
pnpm sync --reseed-slug <google-file-id>
```

Use slug reseeding only for an approved URL change. A normal rename or move
must retain the existing slug. Deletions disappear only after a complete
inventory confirms that the document is outside the managed corpus.

Never test create, move, rename, or delete behavior against production Drive.
Use the protected test Shared Drive corpus.

## Deployment

Every push to `main` starts `.github/workflows/deploy.yml`:

1. run the canonical verification gate;
2. optionally deploy and verify the exact commit on the protected development
   Worker when `ENABLE_DEVELOPMENT_DEPLOYMENT=true`;
3. prove that production anonymous requests are denied and its separate smoke
   service token passes Access;
4. rebuild from the exact commit without transferring build artifacts;
5. deploy `dist` to `example-docs-production` through Wrangler;
6. verify protected HTML, raw Markdown, Pagefind, SVG, `robots.txt`, and the 404
   response.

A Worker deployment reaches every edge location shortly after Wrangler reports
success, so a route added by the deployed commit can still answer from the
previous version. Step 6 therefore retries each unsatisfied check against a
single shared 90-second deadline and logs every wait. Anonymous-denial and
service-token assertions are never retried: an Access finding fails the run
immediately.

The committed Wrangler configuration disables both `workers.dev` and version
preview URLs for both named environments and binds only the approved
development and production hostnames.

Before the first real-content deployment, run:

```bash
pnpm verify
pnpm test:access:preflight
```

Do not run `pnpm deploy:production` with real content from a feature branch or
before the Access preflight passes.

The complete bootstrap and release procedure is maintained in
[Development and production deployment](DEPLOYMENT.md).

## Failure handling

The sync workflow reports aggregate counts through `$GITHUB_STEP_SUMMARY`.
When `SYNC_FAILURE_WEBHOOK_URL` is configured, failure notification contains
only:

```text
Knowledge Base sync failed
Run: <GitHub Actions run URL>
Stage: <configuration|authentication|sync|generated-validation|build|final-generated-validation|commit|push>
Errors: 1
```

It never includes document bodies, titles, tokens, private URLs, or exception
payloads. GitHub notifications remain the fallback when the webhook is absent
or unavailable.

For a failed sync:

1. identify the failed stage from the job summary and safe log category;
2. do not commit or copy partial staged output;
3. fix the source or pipeline on a short-lived branch;
4. run `pnpm verify`;
5. retry the workflow from a clean `main`.

For a failed deployment:

1. confirm that the previous Worker deployment is still active;
2. fix forward when no internal content was exposed;
3. use the rollback workflow for a user-visible regression;
4. treat any anonymous content response as a security incident.

## Rollback

Cloudflare Worker versions are immutable and include the static asset
deployment. To restore a known-good version:

1. Open the `example-docs-production` Worker **Deployments** page.
2. Identify a previously smoke-tested version ID.
3. Open **Actions → Production rollback**.
4. Enter the version ID and type `ROLLBACK`.
5. Approve the `production-deploy` environment gate.
6. Wait for the post-rollback protected smoke test.

The workflow runs an Access preflight before `wrangler rollback`, sends 100% of
traffic to the selected version, and verifies the protected surface
afterwards. Record the incident, restored version, root cause, and subsequent
fix in a private issue or incident system.

If the Access boundary fails:

1. stop sync and deployment workflows;
2. remove or disable any public alternate route;
3. restore the Access application and policies;
4. revoke exposed deploy or service-token credentials;
5. inspect Cloudflare, GitHub, and Google audit logs;
6. re-enable deployment only after the anonymous negative smoke passes.

## Credential rotation

### Google WIF

1. create or validate the replacement read-only identity;
2. update `production-sync` variables;
3. run the Google WIF smoke workflow;
4. run a sync dry-run;
5. remove the old impersonation binding.

Do not introduce a service account JSON key during routine rotation.

### Cloudflare deploy token

1. create a new account- and zone-scoped token;
2. replace `CLOUDFLARE_API_TOKEN` in `production-deploy`;
3. run a manual production deployment;
4. revoke the previous token after the protected smoke succeeds.

### Access service token

1. create the replacement service token;
2. add it to the existing `Service Auth` policy;
3. replace both secrets in `production-smoke`;
4. run `pnpm test:access:preflight` through the environment;
5. delete the old service token.

## Dependency maintenance

Dependabot opens weekly npm and GitHub Actions updates. For every dependency
change:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level high
actionlint
zizmor .github/workflows
gitleaks git --no-banner .
```

Keep all third-party actions pinned to full commit SHAs. Update Wrangler's
compatibility date deliberately, review Cloudflare release notes, and run a
protected deployment smoke after merging runtime or deployment-tool changes.

## Repository policy

`main` should require pull requests for code, resolve review conversations,
require CODEOWNERS review, disable force-push and deletion, and require:

```text
Quality and production build
Workflow and secret scanning
Dependency vulnerability audit
```

The sync bot is the only exception and may push only a verified generated
commit. If the GitHub plan cannot express a narrow bot bypass, replace direct
push with a dedicated GitHub App or a generated-content pull request. Never
weaken the general branch policy to make sync convenient.
