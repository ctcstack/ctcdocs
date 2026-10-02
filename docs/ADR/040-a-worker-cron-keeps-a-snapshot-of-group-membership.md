# ADR-040: A Worker cron keeps a snapshot of group membership

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The Worker decides every request by the reader's Google groups (ADR-039), and
admits a session only while its reader is an active member of the
organization (ADR-038). A Google ID token carries neither fact: it names the
account, not its groups, and stays valid after the account is suspended.

Reading groups and users needs an identity the Workspace has authorized to read
them. The sync reads Drive as a service account reached through workload
identity federation from GitHub Actions, and holds no key. A Worker has no such
federation to Google; to call a Google API on a schedule it must sign a token
with a service account's private key.

Not every Workspace edition offers the same group APIs. Cloud Identity's
membership search is available only on Enterprise editions and Cloud Identity
Premium; the Admin SDK Directory API lists a group's members on every edition.

A change of membership should reach the site within minutes, and a departure
should end access without waiting for a session to expire. Google itself can
take a while to report a change; the site should not add hours to that.

A GitHub Actions schedule could write the snapshot with the sync's federated
identity and no key. It would put a deployment's access control in its CI
system and on CI's schedule, outside the runtime that enforces it.

## Decision

**A dedicated service account reads the directory, and nothing else.** It is
separate from the sync identity, holds no role in its Cloud project, has no
domain-wide delegation and no access to Drive. In the Workspace Admin console it
is assigned one custom admin role that grants read access to groups and to
users. Its JSON key is a secret of the refresh Worker below and of nothing
else, is rotated at least every 90 days, and is created under a narrow
exemption where the organization's policy forbids service account keys by
default. The Admin console's audit log names it as the actor of every read.

**A scheduled Worker of its own refreshes the snapshot every ten minutes.** It
has no route, so the key never sits in the Worker that parses readers'
requests. It signs a JWT with the key through WebCrypto and exchanges it for an
access token. For every group the access rules and admin groups name — and no
other — it reads the group's immutable ID and its members through the
Directory API. Groups hold people directly: a member that is itself a group, or
the whole organization, admits no one through that group and is reported.
Where the Groups Settings API answers it, it also reads whether members may
join themselves or come from outside the organization. It reads the users of
each configured Workspace domain with their ID, whether they are suspended or
archived, and nothing else it does not need; the Directory API refuses the
`my_customer` alias to a service account acting through an admin role, so
users are listed by domain.

**A refresh writes everything or nothing.** If any named group cannot be read,
the refresh writes nothing. A result with no active users, or one that loses
more than a fifth of the active users or of a group's members since the last
snapshot, is not written either; it is reported, and the last snapshot stays.

**The snapshot is keyed by user ID.** It holds when it was taken, the active
users by their Google ID — the `sub` a sign-in carries — and, for each named
group, its pinned ID, its settings and its members by ID. It holds no
addresses. It is one value in the environment's own KV namespace, which only
the refresh Worker writes; the token CI deploys with cannot write it.

**Every request is decided against the snapshot.** The serving Worker keeps
the snapshot in memory for at most a minute. With no snapshot, no session is
admitted (ADR-038), so a new environment's refresh runs once before it opens.
When the snapshot is older than two hours, the last one still decides who is
an active user, but only the members class is served: every other class,
admin groups included, is refused until a refresh succeeds. Machine keys
follow the same rule.

**Nothing personal is logged.** The refresh logs counts, durations and
errors, never an address, an ID or a membership. The snapshot is never written
to the repository, a report or a job summary. Operators see its age and counts
on an admin-only status route under `/_kb/`.

## Consequences

### Positive

- A membership change reaches the site within about ten minutes of Google
  reporting it, and a departure ends every session as fast.
- No reader's request depends on Google, CI or another company system being
  up; it reads only the Worker's own KV.
- One API serves every Workspace edition.
- Only the groups the rules name are read, and the reading identity cannot
  change anything in the directory.

### Negative

- A long-lived private key exists. If it leaks, the directory can be read: the
  organization's user records as an administrator sees them, which can include
  phone numbers and recovery details, and the membership of every group, not
  only the named ones. No document can be read through it and nothing can be
  changed. The narrow role, a Worker of its own, the secret store and rotation
  limit that exposure; they do not remove it.
- Deployments that promised no long-lived Google key must amend that promise
  for this identity.
- A reader waits for Google's own propagation, up to ten minutes for the
  refresh, up to a minute of in-memory cache and up to a minute of KV
  propagation.
- When the directory cannot be read for two hours, readers of closed folders
  lose access until it can. That is the chosen direction of failure.
- A second Worker, Workers KV and two Google APIs become part of the deployment
  and its runbook.

### Follow-up

- A spike on a Business edition confirmed that a custom admin role assigned to
  the service account, without delegation, reads a group's members and each
  domain's users, and that the directory user ID equals the `sub` of a
  sign-in. Whether the Groups Settings API answers the service account is
  open; until it does, invitation-only groups are a runbook rule.
- Add the key rotation, the role, the group policy and an alert on a stale
  snapshot to the operations runbook.
- Update `AGENTS.md` (Workers KV as runtime storage, and a second, read-only
  Google identity), `README.md`, `docs/GOOGLE_WORKSPACE_SETUP.md` and
  `docs/OPERATIONS.md`, which promise no long-lived Google key.
