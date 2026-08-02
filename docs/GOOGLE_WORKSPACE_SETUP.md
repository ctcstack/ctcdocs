# Google Workspace and WIF setup

## Scope

The synchronization identity is read-only and is limited to one Shared Drive.
The configured root folder further narrows publication scope to its
descendants. Items outside that root are inventoried for reconciliation but are
never selected for publication.

Required OAuth scope:

```text
https://www.googleapis.com/auth/drive.readonly
```

Google Docs read-only scope will be added when structural inspection starts in
Phase 3.

## Authentication

The primary authentication path is:

```text
GitHub Actions OIDC
→ Google Workload Identity Federation provider
→ read-only service account impersonation
→ short-lived OAuth access token
→ sync CLI
```

The sync package does not accept or parse a service-account private key. The
protected workflow passes a short-lived `GOOGLE_ACCESS_TOKEN` to the process.
The token is intentionally absent from `.env.example` because it must not be
stored.

The service account must be a Viewer of the test Shared Drive. Do not grant
Editor, Content manager, or Manager access.

## Protected GitHub environment

The `test-drive` environment contains these non-secret variables:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_SYNC_SERVICE_ACCOUNT
GDRIVE_TEST_DRIVE_ID
GDRIVE_TEST_ROOT_FOLDER_ID
GDRIVE_TEST_IGNORED_FOLDER_IDS
```

The ignored-folder variable is optional and contains comma-separated folder
IDs. It must not contain the publication root ID.

The environment is available only to the manual
`.github/workflows/google-wif-smoke.yml` workflow. Pull-request workflows do
not receive an OIDC token or Google configuration.

## Running the integration gate

From GitHub Actions, run **Google WIF smoke test**. The workflow:

1. validates protected environment configuration;
2. exchanges GitHub OIDC for a short-lived Google token;
3. verifies the Shared Drive and publication root;
4. executes the production inventory CLI with `--dry-run --inventory-only`;
5. optionally runs the Phase −1 export probe.

The normal log contains counts and issue categories only. Use `--json` locally
only when an inventory report containing file names and paths is appropriate
for the current security context.

## Production configuration

Production Shared Drive and root IDs are not configured during Phase 1.
Production access must use a separate environment and a separately reviewed
read-only identity. Never reuse mutation-test credentials or the test corpus as
the production source.
