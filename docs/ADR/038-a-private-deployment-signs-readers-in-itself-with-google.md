# ADR-038: A private deployment signs readers in itself, with Google

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: ADR-004, once accepted; ADR-016 in part: how a private deployment
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
`assets.run_worker_first` to `true`. `main` is a top-level setting, so the
Worker runs in every environment; it serves a public environment
(`visibility: "public"`, ADR-016) without sign-in. `workers.dev` and preview
URLs stay disabled, so the configured hostname is the only way in, and the
Worker refuses a request whose `Host` is not that hostname.

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
that `hd` is one of the configured Workspace domains. The `hd` request
parameter is a hint to Google's account chooser and is never trusted.

**A reader is identified by the token's `sub`,** the Google account ID, which is
also the user's ID in the Workspace directory. The address is kept for display
only. An address can be renamed or reassigned; `sub` cannot.

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
session, nor a session from one environment in another. The previous secret is
accepted during a rotation.

**A session is only as good as the directory.** It is admitted only while a
snapshot exists (ADR-040) and lists its `sub` as an active user; with no
snapshot, no session is admitted. There is no server-side session store.
Sign-out is a `POST` with an `Origin` check, and clears the cookie.

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
path, never by forwarding the incoming request. Conditional and range headers
are passed on only after the decision. The routes `/auth/` and `/_kb/` are
reserved, so no Drive name can take them.

**The Worker sets every response header.** Cloudflare does not apply
`_headers` to responses a Worker returns, so the policy moves into the Worker:
private, short-lived caching on everything a reader is admitted to; `no-store`
on sign-in routes, refusals and per-reader answers; `X-Robots-Tag` and
`X-Content-Type-Options: nosniff`; the UTF-8 charset on Markdown and text; and
long-lived caching only for fingerprinted scripts, styles and fonts. A Content
Security Policy limits scripts and connections to the site itself, forbids
plugins and framing, and Mermaid runs at its strict security level.

### Machines and agents

**Machines use keys the deployment issues.** A key is a random 256-bit secret
with a recognizable prefix, presented as a bearer token. The deployment keeps
only its SHA-256 hash, with the key's name, owner, groups and an expiry of at
most 90 days, as a Worker secret rather than in the project configuration, so
merge rights cannot mint a key. A key never reads as an admin group, is never
logged, and is rate-limited. The access smoke test uses one that reads only
the members class (ADR-039).

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

**A version without the gate cannot be deployed or restored.** The platform
build marks the Worker version it produces, and the deploy and rollback
workflows refuse a version without the mark, so rolling back cannot reach a
version from before this decision. The denial suite runs against the
candidate locally before deployment, and again against the live hostname after
it. A scheduled probe, independent of deployment, makes anonymous requests for
a page, a Markdown file and a search bundle, and fails loudly if any is
admitted. The Cloudflare token CI deploys with can deploy this Worker and
nothing else.

**The checks follow.** `visibility: "private"` keeps its meaning and now names
this boundary. The project configuration gains the accepted Workspace domains;
the OAuth client, the signing secret and the machine keys are Worker secrets.
`ctcdocs-sync validate` requires, on a private deployment, `main` to be the
platform's entry, the `ASSETS` binding, `run_worker_first` and a KV binding in
each environment. The access smoke test requires an anonymous page to be
redirected to sign-in, an anonymous Markdown file, `llms.txt` and search bundle
to be refused with `401`, a key to be admitted to a members-class document,
and the real response headers to match the policy.

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
- Three kinds of secret must be kept and rotated per environment: the OAuth
  client secret, the signing secret and the machine keys.
- When Google cannot be reached, no one can sign in; existing sessions keep
  working until they expire.
- Records of who signed in are ours to keep. The Worker logs sign-in outcomes
  by `sub`, never addresses or tokens.
- The product invariants change: the site is still built ahead of time, but it
  is no longer delivered without code of our own.

### Follow-up

- Build the Worker, its adapters, the sign-in routes, the machine keys, the
  version mark and the probe, and exercise them in the fixture project.
- Update `AGENTS.md` (invariants, security rules, review rules), `README.md`,
  `SECURITY.md`, `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md`,
  `docs/CLOUDFLARE_SETUP.md`, `docs/OPERATIONS.md`,
  `docs/LOCAL_DEVELOPMENT.md` and `docs/DESIGN.md`; rewrite
  `tests/e2e/access.spec.ts`, `playwright.ts` and `bin/access-smoke.mjs`; and
  the home page's agent-access copy, which names Access.
- Ignore `.dev.vars`, where Wrangler reads local secrets, in the platform and
  in the fixture project.
- When this record is accepted, mark ADR-004 superseded.
- A local spike carried the sign-in routes through a Worker with no
  dependencies, with placeholder credentials. Still to run: the round trip
  against a real client of an Internal consent screen, and whether `sub`
  equals the directory user ID.
