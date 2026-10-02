# ADR-040: A Worker cron keeps a snapshot of group membership

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The Worker decides every request by the reader's Google groups (ADR-039), and
ends a session when its reader leaves the organization (ADR-038). A Google ID
token carries neither: it names the account, not its groups, and it stays
valid after the account is suspended.

Reading groups and users needs an identity Google Workspace has authorized to
read them. The sync reads Drive as a service account reached through workload
identity federation from GitHub Actions, and holds no key. A Worker has no such
federation to Google: the only way for it to call a Google API on a schedule is
to sign a token with a service account's private key.

A change of membership should reach the site within minutes, and a departure
should end access without waiting for a session to expire. Google itself can
take a while to report a membership change, so the site cannot be faster than
that, but it should not add hours to it.

## Decision

**A dedicated service account reads the directory, and nothing else.** It is
separate from the sync identity, holds no role in the Cloud project, has no
domain-wide delegation and no access to Drive. In the Workspace Admin console
it is assigned one custom admin role that grants read access to users and to
groups. Its JSON key is stored as a Worker secret and nowhere else, and is
rotated at least every 90 days. The Admin console's audit log names it as the
actor of every read.

**The Worker's scheduled handler refreshes a snapshot every ten minutes.** It
signs a JWT with the key through WebCrypto, exchanges it for an access token,
and reads two things: the transitive members of every group the access rules
and admin groups name, through the Cloud Identity Groups API, so nested groups
count; and the active users of the organization, neither suspended nor
archived, with their aliases, through the Admin SDK Directory API. It reads no
other group. It writes one snapshot — when it was taken, each named group's
members, the active users — to a KV namespace, as a single value.

**Every request is decided against the snapshot.** The Worker keeps the
snapshot in memory for at most a minute. A session whose address is not an
active user is refused and its cookie cleared. A reader's groups are the named
groups that list the address.

**A stale snapshot fails closed.** When the snapshot is missing or older than
two hours, the Worker admits signed-in readers to the members class only and
refuses every other class, admin groups included, until a refresh succeeds. A
failed refresh leaves the last snapshot in place and is logged.

**Nothing personal is logged.** The handler logs counts, durations and errors,
never an address or a membership. The snapshot holds addresses and group
memberships, which the platform treats as personal data: it lives in the
deployment's own KV namespace and is never written to the repository, a
report or a job summary.

## Consequences

### Positive

- A membership change reaches the site within about ten minutes of Google
  reporting it, and a departure ends every session as fast.
- No request depends on Google, GitHub or another company system being up; a
  request reads only the Worker's own KV.
- Only the groups that access rules name are read, and the reader identity
  cannot change anything in the directory.

### Negative

- A long-lived private key now exists. If it leaks, the organization's
  directory — names, addresses and the membership of every group — can be
  read, though no document can be and nothing can be changed. The narrow role,
  the secret store and rotation limit, but do not remove, that exposure.
- A deployment that kept "no service account key exists" as a rule must amend
  it for this identity.
- The delay a reader sees is Google's own propagation, plus up to ten minutes,
  plus up to a minute of in-memory cache.
- When the directory cannot be read for two hours, readers of closed folders
  lose access until it can. That is the chosen direction of failure.
- Workers KV, a scheduled handler and two Google APIs become part of the
  deployment and its runbook.

### Follow-up

- Confirm by spike that the custom admin role can be created and assigned to a
  service account on the deployment's Workspace edition, and that the
  Groups API returns transitive members to it without delegation.
- Add the key rotation, the role assignment and a stale-snapshot alert to the
  operations runbook.
- Expose the snapshot's age to operators, through a status route that
  reports age and counts only.
