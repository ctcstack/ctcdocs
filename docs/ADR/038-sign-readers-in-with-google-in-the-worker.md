# ADR-038: A private deployment signs readers in itself, with Google

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: ADR-004; and ADR-016 in part: how a private deployment refuses
  an anonymous reader and admits an automated one

## Context

A private deployment is protected by a Cloudflare Access application in front
of the whole hostname (ADR-004). Access answers one question, whether the
reader belongs to the Workspace, and the site never learns who the reader is.
That was enough while every employee could read everything.

Two needs now require the site itself to know the reader. Folders are to be
readable by some groups and not others (ADR-039), which is a decision per
request, per reader, on files Access cannot tell apart. And AI agents are to
read the corpus through an MCP server, whose clients obtain OAuth tokens on a
reader's behalf and must be held to the same rules as that reader in a browser.
Access can stand in front of both, but the decisions would still have to be
made behind it, against an identity the application would then have to take
from Access's assertion rather than establish itself.

The constraints are unchanged: the content is built ahead of time and served
from Workers Static Assets; only accounts of the organization's Google
Workspace may read; no identity provider other than Google is acceptable; the
platform names no deployment.

`AGENTS.md` has so far said not to add an authentication system of our own.
This record reverses that, for this purpose only.

## Decision

**A private deployment is served through a platform Worker that runs before
every asset.** The Wrangler configuration names the Worker as `main` and sets
`assets.run_worker_first` to `true`, so no file is served unless the Worker
admits the request. The Worker refuses by default: a path it cannot classify is
not served. `workers.dev` and preview URLs stay disabled, as ADR-016 requires,
so the Worker's hostname is the only way in.

**Readers sign in with Google**, through the OpenID Connect authorization code
flow with PKCE, `state` and `nonce`, against an OAuth client of the _Internal_
type in the deployment's Google Cloud project. Google then admits only accounts
of the organization. The Worker verifies the ID token's signature against
Google's published keys and checks its issuer, audience, expiry and nonce,
`email_verified`, and that `hd` equals the configured Workspace domain. The
`hd` request parameter is a hint to Google's account chooser and is never
trusted on its own.

**The Worker issues its own session**, a cookie named with the `__Host-`
prefix, `HttpOnly`, `Secure` and `SameSite=Lax`, signed with HMAC-SHA-256 and
holding the Google subject, the address and an expiry of twelve hours. There is
no server-side session store. A session ends when it expires, when the reader
signs out, or when the directory snapshot (ADR-040) no longer lists the address
as an active user, which the Worker checks on every request.

**An anonymous request is refused by its kind.** A page is redirected to the
sign-in route on the same host and returns to the page afterwards. Anything
else — Markdown, original files, images, search bundles, `llms.txt` — is
answered `401` without a redirect, so agents and scripts fail plainly.

**Machines authenticate with keys the deployment issues.** A key has a name and
the groups it reads as (ADR-039), is stored only as a hash, and is presented in
a request header. The access smoke test uses one, in place of the Access
service token. A key never signs in a browser session.

**MCP clients will sign in the same way.** When the MCP server is built, an
OAuth authorization server in the same Worker issues its tokens, and the
reader's consent step is this Google sign-in. The tokens resolve to the same
identity and the same rules. This record fixes only that much; the MCP server
is its own decision.

**The checks follow.** `visibility: "private"` keeps its meaning — anonymous
readers are refused — and now names this boundary. The project configuration
gains the Workspace domain; the OAuth client, the session signing key and the
API key hashes are Worker secrets and never configuration. `ctcdocs-sync
validate` requires the Worker entry and `run_worker_first` on a private
deployment. The access smoke test requires an anonymous page to be redirected
to the sign-in route, an anonymous Markdown file to be refused with `401`, and
a key to be admitted. The response headers and robots policy of ADR-016 stay.

**Cloudflare Access is no longer required or assumed.** A deployment may keep
an Access application in front while it moves to this boundary; the denial
checks accept an Access refusal as a refusal, so both can run together until
Access is removed.

## Consequences

### Positive

- The site knows who is reading, which per-folder access and an MCP server both
  need, and it knows it the same way for a browser, a script and an agent.
- Membership in the organization is checked by Google, through the client
  type, and again by the Worker, through `hd`.
- Sign-in, sign-out and refusal pages can be part of the site and say what to
  do, instead of being a third party's.
- A deployment no longer depends on a Zero Trust organization and its seats.

### Negative

- The perimeter is our code. A defect in the Worker can open a private
  deployment, where before a defect in the site could not reach past Access.
  The design answers with one entry point that refuses by default, tests for
  every kind of path, and a cutover with Access still in front.
- Every request, including every image and script, now runs the Worker and is
  billed as a Worker request.
- Three kinds of secret must be kept and rotated: the OAuth client secret, the
  session signing key, and the machine keys. Rotating the signing key signs
  every reader out.
- When Google cannot be reached, no one can sign in; existing sessions keep
  working until they expire. Access with Google as its provider had the same
  dependency.
- The product invariants change: the site is still built ahead of time, but it
  is no longer delivered without code of our own.

### Follow-up

- Build the Worker, the sign-in routes, the machine keys and the new smoke
  test in the platform, and exercise them in the fixture project.
- Update `AGENTS.md` (invariants and security rules), `docs/CONFIGURATION.md`,
  `docs/DEPLOYMENT.md` and `docs/CLOUDFLARE_SETUP.md`, and add a Google OAuth
  client setup and a cutover runbook.
- A local spike carried the sign-in flow, the forged-state and forged-cookie
  refusals and the domain check through a Worker with no dependencies; the
  round trip against a real Internal client is still to be run.
