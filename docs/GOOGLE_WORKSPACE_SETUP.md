# Google Workspace and the synchronization identity

The pipeline reads one Shared Drive and writes nothing back. This document is
how that identity is created and constrained.

## Scope

The identity is read-only and limited to a single Shared Drive. A configured
root folder narrows publication further to that folder's descendants: items
outside it are inventoried for reconciliation but never selected for
publication.

One OAuth scope is used:

```text
https://www.googleapis.com/auth/drive.readonly
```

The service account must be a **Viewer** of the Shared Drive. Do not grant
Editor, Content manager, or Manager. Nothing in the pipeline creates, edits,
moves, deletes, or reshares anything, and the identity should be unable to even
if a bug tried.

## Authentication

```text
GitHub Actions OIDC
→ Google Workload Identity Federation provider
→ read-only service account impersonation
→ short-lived OAuth access token
→ ctcdocs-sync
```

The pipeline accepts a token and nothing else. It does not read, parse, or
accept a service-account private key, so there is no long-lived Google
credential to store, rotate, or leak. `GOOGLE_ACCESS_TOKEN` is passed to the
process by the workflow that just minted it.

A key file remains possible for someone who insists — the token has to come from
somewhere — but it is not the supported path and this repository does not
document it.

## What has to exist in Google Cloud

In a project that can be separate from everything else you run:

1. **A workload identity pool**, and in it **an OIDC provider** whose issuer is
   `https://token.actions.githubusercontent.com` and whose allowed audience is
   the one your workflow requests.
2. **An attribute mapping** carrying at least `google.subject` from
   `assertion.sub`, plus whichever of `assertion.repository`,
   `assertion.repository_owner` and `assertion.ref` your condition uses.
3. **An attribute condition** that names your repository. Without one, any
   GitHub repository in the world can present a token to this provider. Bind it
   as tightly as the workflow allows — the repository, and where it makes sense
   the ref or the environment.
4. **A service account** with no roles in the project. Its only power is being
   a Viewer on the Drive.
5. **A binding of `roles/iam.workloadIdentityUser`** on that service account for
   the `principalSet` matching the same repository, so the federated identity may
   impersonate it and nothing else may.

Then share the Shared Drive with the service account's address as Viewer.

## What the workflow needs

`project-sync.yml` reads these from the GitHub environment it runs in. None is
secret; all of them identify rather than authorize:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_SYNC_SERVICE_ACCOUNT
GOOGLE_DRIVE_ID
GOOGLE_ROOT_FOLDER_ID
GOOGLE_IGNORED_FOLDER_IDS
```

`GOOGLE_IGNORED_FOLDER_IDS` is optional, comma-separated, and must not contain
the publication root.

Pull-request workflows receive no OIDC token and no Google configuration. A
fork's pull request cannot reach a Drive, which is the point.

## Test and production corpora

Use a separate Shared Drive, a separate identity, and a separate GitHub
environment for anything experimental. Never point a mutation test or a scratch
corpus at the Drive a real deployment publishes from, and never reuse one
identity for both.
