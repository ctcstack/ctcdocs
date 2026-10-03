# Google Workspace setup

A private deployment talks to Google three ways, each with its own identity
and nothing more than it needs:

| Identity                                                      | Used by              | Can                                                   |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------- |
| [The synchronization identity](#the-synchronization-identity) | the sync workflow    | read one Shared Drive                                 |
| [The sign-in client](#sign-in)                                | the site Worker      | learn who a reader is, once, when they sign in        |
| [The directory reader](#the-directory-reader)                 | the directory Worker | read the members of named groups and the active users |

None of them can change anything in Google. A public deployment needs only the
first.

## The synchronization identity

The pipeline reads one Shared Drive and writes nothing back. This section is
how that identity is created and constrained.

### Scope

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

### Authentication

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
document it. The directory reader below is the one identity with a key, and the
key lives only in a Worker secret.

### What has to exist in Google Cloud

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

### What the workflow needs

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

### Test and production corpora

Use a separate Shared Drive, a separate identity, and a separate GitHub
environment for anything experimental. Never point a mutation test or a scratch
corpus at the Drive a real deployment publishes from, and never reuse one
identity for both.

## Sign-in

Readers sign in with Google through an OAuth client the deployment owns
(ADR-038). In a Google Cloud project — the synchronization project will do:

1. **Google Auth Platform → Branding**: the application name readers see, and
   a support address.
2. **Audience**: user type **Internal**. Google then refuses every account
   outside the organization before the site is reached, and the client needs
   no verification.
3. **Data access**: `openid` and `email`. The Worker asks for nothing else.
4. **Clients → Create client**: type **Web application**, and one authorized
   redirect URI per environment:

   ```text
   https://docs.example.com/auth/callback
   ```

   No JavaScript origin is needed.

The client ID goes into `wrangler.jsonc` as the `GOOGLE_CLIENT_ID` variable and
the secret into the `GOOGLE_CLIENT_SECRET` Worker secret; see
[Cloudflare setup](CLOUDFLARE_SETUP.md#the-site-worker).

`signIn.workspaceDomains` in `site.config.json` lists every domain of the
organization — the primary one and any secondary ones. The Worker accepts an
ID token only when its `hd` claim is one of them, and identifies the reader by
the token's `sub`, which is the directory's user ID. A personal account is
refused even if the consent screen were ever made external.

## The directory reader

The directory Worker reads group membership every ten minutes (ADR-040). It
uses a service account of its own, separate from the synchronization identity:

1. In the Cloud project, enable the **Admin SDK API** and the **Groups
   Settings API**.
2. Create a service account with no roles in the project, and a JSON key for
   it. Put the key into the `DIRECTORY_KEY` secret of the directory Worker and
   delete the file.
3. In the **Admin console → Account → Admin roles**, create a custom role with
   only these Admin API privileges:

   ```text
   Users → Read
   Groups → Read
   ```

4. Assign the role to the service account by its address.

No domain-wide delegation, no Drive access and no other role. The Groups
Settings API offers no read-only scope; the role, which grants only Read, is
what keeps the account read-only. Users are listed per configured domain,
because the Directory API refuses the `my_customer` alias to an account acting
through an admin role.

This works on every Workspace edition. Cloud Identity's transitive membership
search would read nested groups, but it is not available on Business editions,
and the platform does not use it.

## Groups that name readers

A group an access rule names decides who reads a folder, so it is managed like
a permission:

- **People are members directly.** A group inside a group is not read; the
  refresh reports the group as admitting no one rather than guessing.
- **Members join by invitation only**, and **no one from outside the
  organization** may be a member. The refresh reads both settings and treats a
  group that allows either as admitting no one.
- **The whole organization is never a member.** Use `"*"` in the rule instead.
- **Administrators** are a group too — conventionally `kb-admins@` — named in
  `access.admins`. Its members read everything, including the content health
  page; a machine key never does.

Groups are managed where the organization already manages them: the Admin
console or Google Groups. The site reads them; it never changes them. A group
deleted and recreated under the same address is a different group: the refresh
pins each group's ID the first time it reads it and admits no one through a
recreated group until an operator resets the pin; see
[Operations](OPERATIONS.md#the-directory-snapshot).
