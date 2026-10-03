# ADR-038: A private deployment signs readers in itself, with Google

- Status: Accepted
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: ADR-004; ADR-016 in part: how a private deployment
  refuses an anonymous reader, admits an automated one and sets its response
  headers; ADR-010 in part: the Markdown projection is served through a
  runtime script that authorizes it; and ADR-007 in part: what each
  environment holds in place of its own Access application and service token

## Context

A private deployment is protected by a Cloudflare Access application in front
of the whole hostname (ADR-004). Access decides whether a reader belongs to the
Workspace; the site itself never learns who the reader is.

Folders are to be readable by some groups and not others (ADR-039). That is a
decision per request and per reader, about files whose paths do not reveal
their folder — `/_astro/` images, Pagefind fragments, `/assets/generated/`
originals — and about addresses that move with Drive names (ADR-021). Only
code that knows the build's own map of files can make it, so a Worker must run
before every asset whatever else stands in front. AI agents are also to read
the corpus through an MCP server whose OAuth clients act for a reader and must
meet the same rules.

Access could stay in front and hand that Worker an identity, through the signed
`Cf-Access-Jwt-Assertion` header, and its managed OAuth could serve MCP
clients. Sign-in, sessions, sign-out and agent authorization would then belong
to one vendor's product. The platform is meant to keep a deployment movable to
another host or server without re-implementing its identity layer, and to own
what a session holds and how it ends.

The content is built ahead of time. Only accounts of the deployment's Google
Workspace organization may read. Google is the only identity provider. The
platform names no deployment.

`AGENTS.md` says not to add an authentication system of our own; this record
reverses that, for this purpose only.

## Decision

### The gate

**A platform Worker runs before every asset.** The Wrangler configuration names
the platform's Worker as `main`, binds the static assets as `ASSETS` and sets
`assets.run_worker_first` to `true`. A deployment is gated when any of its
environments is private; `main` is a top-level setting, so the Worker then runs
in every environment, and serves a public one (`visibility: "public"`,
ADR-016) without sign-in, with the headers `_headers` would have set.
`workers.dev` and preview URLs stay disabled, so the configured hostname is the
only way in, and the Worker refuses a request whose `Host` is not that
hostname.

**Nothing is read before the connection is private.** A page asked for over
plain HTTP is sent to HTTPS and anything else is refused, before a cookie or a
key is looked at; every answer carries `Strict-Transport-Security`.

**The core is written to run elsewhere.** Sign-in, sessions and access
decisions use only web-standard APIs: `Request`, `Response`, `URL`, `Headers`,
`fetch` and WebCrypto. What is specific to Cloudflare stays behind four small
adapters: the file store (`ASSETS`), the key-value store (Workers KV), the
schedule (Cron Triggers) and the secrets (Worker environment). The core uses no
`HTMLRewriter`, no `request.cf` and no Durable Objects, and its unit tests run
on Node. Google is configured as an OpenID Connect provider by issuer and
client; the Workspace checks are configuration. Moving to another host means
writing the four adapters, not a new identity layer.

### Signing in

**Readers sign in with Google** through the OpenID Connect authorization code
flow with PKCE, `state` and `nonce`. The OAuth client is a web application
client in a Google Cloud project of the organization, whose consent screen's
user type is _Internal_, so Google admits only the organization's accounts.
The `redirect_uri` comes from configuration, never from the request.

The Worker verifies the ID token's signature against Google's published keys,
which it caches as their `Cache-Control` allows and refetches, at most once a
minute, for an unknown key ID. It checks the issuer, the audience, the expiry
and issue time with a minute of allowed skew, the nonce, `email_verified`, and
that `hd` is one of the configured Workspace domains. `hd` names the domain of
the reader's own primary address, so an organization with secondary domains
lists each of them. The `hd` request parameter is a hint to Google's account
chooser and is never trusted.

**A reader is identified by the token's `sub`,** the Google account ID, which is
also the user's ID in the Workspace directory. The address is kept for display
only. An address can be renamed or reassigned; `sub` cannot. Someone Google
signs in whom the directory snapshot (ADR-040) does not list as active — a new
account before the next reading, a suspended one — is told so, and gets no
session.

**The page a reader asked for is kept inside the sealed transaction cookie**,
one cookie per `state`, so sign-ins from parallel tabs do not collide. After
sign-in the reader returns to it only if, once decoded, it is a path on this
host beginning with a single `/`; otherwise to `/`.

### Sessions

**The Worker issues its own session**: a cookie named with the `__Host-`
prefix, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`, holding the reader's
`sub`, address, issue time and an absolute expiry of twelve hours. Every value
the Worker seals names its purpose (`typ`), its environment (`aud`) and its
key (`kid`), and each purpose is signed with its own key derived by HKDF from
the environment's secret, so a transaction cookie can never be presented as a
session, nor a session from one environment in another. Sealed values are
signed, not encrypted: whoever holds the cookie can read the address in it.
The previous secret is accepted during a rotation.

**A session is only as good as the directory.** It is admitted only while a
snapshot exists (ADR-040) and lists its `sub` as an active user; with no
snapshot, no session is admitted. There is no server-side session store.
Sign-out is a `POST` with an `Origin` check, offered as a form in the header
and the mobile menu; it clears the cookie and asks the browser to clear its
cache of the site (`Clear-Site-Data`). It does not sign the reader out of
Google.

### Every request

**An anonymous request is answered from the request alone**, before anything
is looked up, so the answer does not reveal whether a path exists. A
navigation (`Sec-Fetch-Mode: navigate`, or an HTML `Accept`) is redirected to
the sign-in route; anything else gets `401`. The sign-in, sign-out and refusal
pages are self-contained, with their styles inline, so nothing else is served
before sign-in.

**Paths are made canonical before they are judged.** The Worker accepts `GET`
and `HEAD`, and `POST` only on its own routes. It decodes a path once and
refuses encoded separators, dot segments, `NUL` and empty segments. It
resolves `/x`, `/x/` and `/x/index.html` itself, judges the result against
the access map (ADR-039), and fetches the file it authorized by that canonical
path, never by forwarding the incoming request. It follows no redirect the
file store answers with, since that would hand over another file under this
path's class, and validation refuses a `public/_redirects` file on a gated
deployment. Conditional and range headers are passed on only after the
decision. The sync reserves the addresses `auth`, `pagefind` and `assets`, and
no Drive name yields an address beginning with `_`, so `/auth/` and `/_kb/`
stay the Worker's.

**The Worker sets every response header.** Cloudflare does not apply
`_headers` to responses a Worker returns, so the policy moves into the Worker:
private, short-lived caching on everything a reader is admitted to; `no-store`
on sign-in routes, refusals and per-reader answers; `X-Robots-Tag` and
`X-Content-Type-Options: nosniff`; `Strict-Transport-Security`; the UTF-8
charset on Markdown and text; and long-lived caching only for fingerprinted
scripts, styles and fonts. A Content
Security Policy limits scripts and connections to the site itself, forbids
plugins and framing, and Mermaid runs at its strict security level.

### Machines and agents

**Machines use keys the deployment issues.** A key is a random 256-bit secret
with a recognizable prefix, presented as a bearer token. The deployment keeps
only its SHA-256 hash, with the key's name, owner, groups and expiry, in a
record in the environment's KV namespace rather than in the project
configuration or a Worker secret: the token CI deploys with cannot write the
namespace, so merge rights cannot mint a key, and a rollback, which restores a
version's secrets with its code, cannot revive a revoked one. A record whose
expiry is more than 90 days away — and a day for clocks — admits nothing. A key
never reads as an admin group and is never logged. `ctcdocs-machine-key`
issues one. The access smoke test uses one that reads only the members class
(ADR-039). Keys are not rate-limited yet; that comes with the MCP server,
whose clients are the case it matters for.

**MCP clients will sign in the same way.** When the MCP server is built, an
OAuth authorization server in the Worker issues its tokens. Its user step is
this sign-in, preceded by a consent page of its own for each client, which
names the client and its exact registered redirect URI, carries a CSRF token
and cannot be framed. Its tokens are bound to this server, never passed
through to another, and checked against the snapshot like a session. The
library is chosen with the MCP server, under the adapter rule above.

### Environments, deployment and checks

**Every environment has its own** OAuth client, signing secret, KV namespace,
directory key (ADR-040) and machine keys.

**A version without the gate cannot be restored.** The deploy workflow tags
every version of a gated deployment, and the rollback workflow refuses a
version without the tag, so rolling back cannot reach a version from before
this decision. Unless asked to, it also refuses a version older than a change
to the Worker's secrets, which a rollback would bring back. The denial suite
— the real gate in front of the real build, asked for every file as different
readers — runs against the candidate before deployment; after it, the smoke
test checks the live hostname. A scheduled probe, independent of deployment,
makes anonymous requests for a page, a Markdown file, the agent index and the
search runtime, and fails loudly if any is admitted. The Cloudflare token CI
deploys with can deploy the deployment's Workers and has no KV permission.

**The checks follow.** `visibility: "private"` keeps its meaning and now names
this boundary. The project configuration gains the accepted Workspace domains;
the OAuth client secret and the signing secret are Worker secrets.
`ctcdocs-sync validate` requires, on a gated deployment, `main` to be the
platform's entry, the `ASSETS` binding, `run_worker_first`, a KV binding and
the client ID in each environment, and the directory Worker of ADR-040. The
access smoke test requires anonymous requests for the home page, a Markdown
file, the favicon, the agent index, the search runtime and a missing path to
be refused — `401`, or a redirect to sign-in — and a key to be admitted to the
home page and to a document every member may read, whose Markdown carries the
private cache policy, `noindex` and its charset.

**Access is removed when the gate goes live.** The platform keeps no
dependency on it.

## Consequences

### Positive

- The site knows who is reading — the same way for a browser, a script and an
  agent — which per-folder access and an MCP server both need.
- Sign-in, sessions, sign-out and refusal are the platform's own, and the
  identity layer moves with the code to another host.
- Membership in the organization is checked by Google, through the consent
  screen's user type, and again by the Worker, through `hd`.
- A deployment no longer depends on a Zero Trust organization and its seats.

### Negative

- The perimeter is our code. A defect in the Worker can open a private
  deployment to anyone, and anyone who can deploy the Worker controls who
  reads. The canonical paths, the separate keys per purpose, the deploy and
  rollback guard, the independent probe and a narrow deploy token answer
  this; none removes it.
- Every request, including every image and script, runs the Worker and is
  billed as a Worker request. The Workers Free plan's daily request and CPU
  limits do not fit; a private deployment needs the Paid plan.
- Sign-out clears the reader's own cookie only. A copied session cookie stays
  valid until it expires or its reader leaves the organization, at most twelve
  hours.
- Two secrets must be kept and rotated per environment, the OAuth client
  secret and the signing secret, and the machine key records beside them in
  KV. A rollback restores a version's secrets, so the rollback workflow
  refuses to cross a rotation unless asked.
- A leaked key reads what its groups read until it is revoked or expires: it
  is not rate-limited yet.
- When Google cannot be reached, no one can sign in; existing sessions keep
  working until they expire.
- Records of who signed in are not kept. The Worker logs that a sign-in
  succeeded or why it failed, never an ID, an address or a token.
- The product invariants change: the site is still built ahead of time, but it
  is no longer delivered without code of our own.

### Follow-up

- Rate-limit machine keys with the MCP server, and record its authorization
  server and library in their own decision.
- A spike ran the sign-in through a Worker with no dependencies, against a web
  client of an Internal consent screen: every check above passed for an account
  of the organization; an account outside it was refused by Google itself, with
  `org_internal`, before the Worker was reached; a tampered session cookie was
  refused; and the `sub` matched the user's ID in the directory.
