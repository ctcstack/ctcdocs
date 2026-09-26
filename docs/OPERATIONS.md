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

Promotion through a development environment is a project's choice: it calls
the deployment workflow once per environment, and makes production `needs:` the
development job when development should gate it.

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

`project-sync.yml` carries no schedule of its own — the project's calling
workflow decides when it runs, and should also offer `workflow_dispatch`. Twice
daily is a reasonable default; offsetting from the start of the hour reduces
exposure to peak GitHub Actions scheduling load. Scheduled execution is
best-effort in any case, so use the manual run when a content update is
time-sensitive.

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
runs `pnpm verify`, scans every changed generated file for secrets, stages only
generated paths, and pushes without force. A concurrent human merge causes a
safe non-fast-forward failure; the next run starts from the new `main`.

No-op syncs create no commit. A successful content commit uses:

```text
chore(content): sync Google Drive content
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

### Letters from one alphabet

A word in a Drive name uses letters of one alphabet
([ADR-020](ADR/020-letters-from-one-alphabet.md)). A Cyrillic `С` typed into
`Company` looks right, but it would become part of the document's permanent
address. So the sync stops at inventory, before anything is exported, whatever
`SYNC_FAIL_ON_WARNING` says:

```text
ERROR [INVENTORY_GRAPH]: mixed_script_name
ERROR [INVENTORY_GRAPH]: mixed_script_name itemId=<Google file ID> U+0421 Cyrillic at character 1
```

Open the item by its ID, retype the letter at that position, and rerun the
sync. Only Latin, Cyrillic and Greek are checked against each other, and words
are split at spaces, hyphens and punctuation, so `SEO-продвижение` is accepted.

A project whose names are all in one alphabet can say so with
`navigation.nameScripts` (see [Configuration](CONFIGURATION.md)). A letter of
any other script is then reported as `disallowed_name_script`, which also
catches a whole word typed on the wrong layout.

An item published before the rule keeps its address when its title is
corrected. Changing the address is a slug reseed, below.

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

### Addresses that follow names

While a corpus is still being arranged, set `navigation.addresses` to
`follow-names` ([ADR-021](ADR/021-addresses-may-follow-names.md)). Every sync
over the whole corpus then gives each folder and document the address its
current Drive path yields, as a reseed would, and leaves a redirect from the
old address. A renamed folder moves with everything below it. The sync summary
reports how many addresses moved:

```text
Addresses moved (redirects kept): 3
```

Renumbering moves nothing, because the order prefix is not part of an address.
A sync targeted at one file keeps every other address where it is. A redirect
is never given to a different item: a new document that wants a moved
document's old address gets a suffixed one instead. A document renamed back
reclaims its earlier address.

Switch back to `stable` once people have started sharing links. The addresses
stay where they are, and so do the redirects. The first sync after switching
to `follow-names` moves every address that has drifted from its item's name.

In either mode, the redirects that point at a folder or document are removed
when it leaves the corpus.

Never test create, move, rename, or delete behavior against production Drive.
Use the protected test Shared Drive corpus.

## Deployment

Every push to `main` starts `.github/workflows/deploy.yml`:

1. run the canonical verification gate;
2. deploy and verify the same commit on a development environment first, if
   the project declares one and gates on it;
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
Documentation sync failed
Run: <GitHub Actions run URL>
Stage: <configuration|authentication|sync|generated-validation|build|final-generated-validation|secret-scan|commit|push>
Errors: 1
```

It never includes document bodies, titles, tokens, private URLs, or exception
payloads. A secret scan failure is reported by its stage alone: the rule, the
file and the document stay in the run log. GitHub notifications remain the fallback when the webhook is absent
or unavailable.

For a failed sync:

1. identify the failed stage from the job summary and safe log category;
2. do not commit or copy partial staged output;
3. fix the source or pipeline on a short-lived branch;
4. run `pnpm verify`;
5. retry the workflow from a clean `main`.

A failed Google request ends the sync step with one line:

```text
ERROR [GOOGLE_<CATEGORY>]: status=<HTTP status> reason=<code> fileId=<Google file ID> requestId=<ID>
```

`reason` is the machine-readable code Google returned, and `fileId` the file
the request was about — the document being exported or inspected, or the
configured root folder. Each is left out when there is none. Google's own error
message is never printed, because it can quote a title or a URL. A file ID
names a document without revealing it: the manifest already records every
published one, and opening it still takes access to the Drive.

| Category                     | Reason                                       | What to do                                                                                                                |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_RATE_LIMIT`          | `rateLimitExceeded`, `userRateLimitExceeded` | Already retried with exponential backoff before failing. Rerun later.                                                     |
| `GOOGLE_RATE_LIMIT`          | `dailyLimitExceeded`                         | A daily quota; not retried. Review the Drive API quotas of the Cloud project.                                             |
| `GOOGLE_EXPORT_SIZE_LIMIT`   | `exportSizeLimitExceeded`, or none           | Google exports at most 10 MB, images included. Split the document or reduce its images.                                   |
| `GOOGLE_DOWNLOAD_RESTRICTED` | `cannotExportFile`, `cannotDownloadFile`     | The document stops viewers from downloading it. Lift that restriction; do not raise the identity above Viewer.            |
| `GOOGLE_PERMISSION`          | `SERVICE_DISABLED`, `accessNotConfigured`    | The Drive or Docs API is not enabled in the Cloud project.                                                                |
| `GOOGLE_PERMISSION`          | any other, or none                           | The identity cannot read the file. Check that it is still a Viewer of the Shared Drive and the file is inside that Drive. |

The command exits with 2 for `GOOGLE_AUTHENTICATION`, 3 for `GOOGLE_PERMISSION`
and `GOOGLE_DOWNLOAD_RESTRICTED`, and 1 otherwise.

A failure at the `secret-scan` stage has a procedure of its own:
[Secret scan findings](#secret-scan-findings).

For a failed deployment:

1. confirm that the previous Worker deployment is still active;
2. fix forward when no internal content was exposed;
3. use the rollback workflow for a user-visible regression;
4. treat any anonymous content response as a security incident.

## Secret scan findings

A sync commit is pushed with the workflow's own token, and a push made with it
starts no other workflow, so the project's CI never scans it. The sync therefore
scans every generated file the run added or changed before it commits. It uses
the gitleaks release the CI gate runs, and the project's own `.gitleaks.toml` and
`.gitleaksignore`. The decision is recorded in
[ADR-018](ADR/018-secret-scan-before-sync-commit.md).

A finding fails the run at the `secret-scan` stage. Nothing is committed or
pushed, so `main` and the deployment keep the last good output, and every other
document's update waits with it. Each finding is one line:

```text
ERROR [SECRET_SCAN]: rule=<gitleaks rule ID> path=<generated file> line=<line> fileId=<Google file ID>
```

`fileId` is the document — or the folder, for a section page — that the
manifest records for the file. It is left out for the outputs no single file
owns: the sidebar, the redirect map and the data files. `line` counts lines of
the generated Markdown, not of the Google Doc. The value is never printed, and
neither is the text around it: the scanner redacts its report, writes it
outside the repository, and the report is deleted once read.

The command exits with 5 for findings. It exits with 1 when the scan could not
run or its result could not be trusted: the scanner is missing or failed,
`.gitleaks.toml` is missing, or `.gitleaks.toml` exempts a file the run changed.
The scanner's own messages are withheld from the log; reproduce a scanner
failure by running `gitleaks dir --no-banner .` in a checkout of the project.

For a finding:

1. Find the value in the document the file ID names. To see the exact line,
   export that one document locally with `pnpm sync --file <google-file-id>`
   and open the generated file at the reported line. With the pinned gitleaks
   on `PATH`, `pnpm exec ctcdocs-sync scan:generated-diff` then repeats the
   scan, and confirms an allowlist entry before it goes to review.
2. **A credential:** treat it as exposed to everyone who can read the document.
   Rotate it, then remove it from the document and rerun the sync. It never
   reached Git or the site.
3. **Not a credential** — an example key, a placeholder, an identifier shaped
   like one: accept it in a reviewed pull request to the project, then rerun the
   sync. Prefer an allowlist scoped to the rule and naming the value:

   ```toml
   [[allowlists]]
   description = "Placeholder key in the integration guide's examples"
   targetRules = ["generic-api-key"]
   regexes = ['''^<the exact placeholder value>$''']
   ```

   The alternative is a line in `.gitleaksignore` copied from the finding,
   `<path>:<rule>:<line>`. It silences that rule at that line of that file, for
   the sync and for both CI scans. It stops matching when an edit above the
   value moves it, and it keeps silencing whatever later lands on that line.

Two routes are refused. A `paths` exemption covering generated files is rejected
by both `validate` and the scan. `gitleaks:allow` written into the document is
ignored, because the sync scans with `--ignore-gitleaks-allow`: an allowlist
entry goes through review, and document text does not. Anchor path exemptions
at the repository root (`^dist/` rather than `(^|/)dist/`), so that a Drive
folder whose slug matches one cannot exempt its documents.

The scan reads only what a run changes. A value an earlier sync committed is
what the CI gate's history scan reports, on whichever pull request runs next.
Rotate it first, then remove it from the document so the next sync removes it
from the corpus. History still holds it. Either rewrite history, which is the
project's decision and requires every clone to be refreshed, or record the
finding's commit-qualified fingerprint, `<commit>:<path>:<rule>:<line>`, in
`.gitleaksignore`. Use the commit-qualified form here. The short form would also
let through a new value that lands on the same line of the same document.

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

Keep all third-party actions pinned to full commit SHAs. The gitleaks release
and checksum in `project-sync.yml` and `project-ci.yml` move together, so the
sync scan and the CI gate apply the same rules; a test fails when they differ. Update Wrangler's
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
