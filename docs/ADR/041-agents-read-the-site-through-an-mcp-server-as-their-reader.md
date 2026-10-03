# ADR-041: Agents read the site through an MCP server, as their reader

- Status: Accepted
- Date: 2026-10-03
- Owners: CTCDocs maintainers
- Supersedes: ADR-038 in part: what may be specific to Cloudflare (an OAuth
  library, an R2 bucket and an AI Search instance join its four adapters), and
  how MCP clients sign in (any client may connect; there is no list of allowed
  ones)

## Context

People want the knowledge base inside the AI assistants they already use —
claude.ai, ChatGPT, Claude Code, Cursor — from whatever account they use them
with. They must see there exactly what they may read on the site (ADR-039),
for as long as they are in the Workspace (ADR-040). Connecting has to be as
simple as pasting one address and signing in.

What the clients expect, as of this decision:

- A remote MCP server over Streamable HTTP. The current revision (2026-07-28)
  is stateless; older clients still open with `initialize`, and neither needs
  a session on the server. An unauthenticated request gets `401` with a
  pointer to the server's Protected Resource Metadata (RFC 9728). The
  authorization server publishes RFC 8414 metadata, requires PKCE with S256
  and binds each token to the server (RFC 8707).
- A client identifies itself by a Client ID Metadata Document (CIMD) —
  claude.ai, Claude Code and ChatGPT each publish one — or registers itself
  dynamically (DCR), which other clients still rely on.
- ChatGPT uses its stable callback only when the authorization server returns
  `iss` (RFC 9207), and keeps refreshing only when `offline_access` is
  advertised. Its company knowledge uses only servers whose read-only `search`
  and `fetch` tools have a fixed shape.
- Cloudflare's `workers-oauth-provider` (1.2) is an OAuth authorization and
  resource server for Workers: CIMD, DCR, PKCE, `iss`, resource binding,
  rotating refresh tokens, hashed storage in a KV namespace bound as
  `OAUTH_KV`, and consent helpers. Sign-in is left to the application.
  `createMcpHandler` serves stateless MCP without Durable Objects.
- Cloudflare AI Search indexes an R2 bucket with hybrid keyword and vector
  search, filters by up to five custom metadata fields set on the objects,
  and is reached from a Worker through a binding. It is in open beta and free
  within its limits. Its own MCP endpoint does not know who is asking, so it
  cannot be the server itself.
- Pagefind cannot search inside a Worker: its runtime compiles WebAssembly
  from bytes, which Workers forbid.

Bots already read the Markdown projections and `llms.txt` with machine keys
(ADR-038, ADR-033). That stays as it is.

References: the MCP authorization specification
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>),
OpenAI's MCP tool shapes (<https://developers.openai.com/api/docs/mcp>),
Claude's connector authentication
(<https://claude.com/docs/connectors/building/authentication>),
`workers-oauth-provider` (<https://github.com/cloudflare/workers-oauth-provider>)
and AI Search (<https://developers.cloudflare.com/ai-search/>).

### What a spike showed

A spike on 2026-10-03 ran this design on a test hostname, with
`workers-oauth-provider` 1.2.1, `createMcpHandler` (Agents SDK 0.26), the
Workspace's Google sign-in and an AI Search instance over an R2 bucket of
synthetic documents in two classes.

- **claude.ai, Claude Code, Claude Desktop and ChatGPT** each connected
  through their published CIMD identity, showed the consent page, signed in
  with a Workspace account and answered from a document, citing its permanent
  link. Claude Code opened with `server/discover`, the current revision's
  first call. CIMD documents resolve when fetched from Cloudflare's network,
  although `chatgpt.com` refuses the same fetch from a local `wrangler dev`.
- **Classes are read per request.** A restricted document was neither found
  nor fetched. When its class opened, the same connected assistant read it
  without reconnecting, and lost it again when the class closed, each time
  within one or two minutes of the change: the time a KV write takes to
  reach every location.
- **Search matches meaning and language.** Paraphrased questions found the
  right document, and a Russian question found an English one. With nothing
  readable to match, search returned a loosely related document instead of
  nothing.
- **What is needed once per account:** an AI Search service token, without
  which an instance cannot read R2. Wrangler's `r2 object put` cannot set
  custom metadata. A newly created instance starts a sync at once, and a sync
  started while another runs is refused (`sync_in_cooldown`).
- **The consent page's CSP** has to let its form lead to Google and to the
  client's callback: `form-action 'self' https://accounts.google.com` plus
  the redirect URI's origin. A policy cannot name an IPv6 address, and
  Chrome ignores one, so a callback at an IPv6 address is allowed by its
  scheme instead: `http:` for the loopback `http://[::1]` native apps use,
  the only address the library accepts over `http`, and `https:` otherwise.
- **Size:** the Worker with the library, the SDK and the tools is 1.4 MB, or
  259 KB gzipped, and starts in 41 ms.

## Decision

### Connecting

**The deployment's Worker serves MCP at `/mcp`**, on the site's own hostname.
A person adds `https://<host>/mcp` to their assistant — any assistant, any
account — and signs in with their Workspace Google account. Nothing else is
set up per person or per assistant.

**The Worker is the authorization server, with `workers-oauth-provider`.** It
accepts both CIMD and DCR, so any MCP client can connect, and keeps no list of
allowed clients: who may read is decided by the sign-in, not by the client.
Its endpoints sit under `/auth/` beside the sign-in routes, its metadata under
`/.well-known/`. The gate hands these and `/mcp` to the library after its host
and HTTPS checks, and their answers carry the gate's headers. `mcp` is not a
reserved slug: the server answers `/mcp` exactly, and a page or a folder
named so is served at `/mcp/`, so a corpus that has one keeps it whether or
not the server is on.

**Authorizing is one confirmation and the usual sign-in:**

1. One page, from the library's consent helpers, names the client and where
   it returns, with one button. It cannot be framed, and its CSP lets the form
   lead only to Google and to that client's redirect URI.
2. Their live site session is used or, without one, they sign in exactly as
   on the site (ADR-038), which returns them to `/auth/connect`. Google's
   callback is the site's alone, and the snapshot must list them as active
   (ADR-040).
3. The grant is completed with the person's `sub` as its user and nothing
   else.

**Access tokens live an hour.** Refresh tokens rotate and last 30 days from
the sign-in, after which the person connects again. `offline_access` is
advertised so that clients keep refreshing.

### Every request is checked like a page

A token must be ours, unexpired, bound to `/mcp` and carry `kb:read`, which
consent always grants, so that a client asking for no scope can read. Its
`sub` must be active in the snapshot, and the reader's groups — so their
classes — are read from the snapshot on each request, not from the grant. A
change of groups or a departure applies within the snapshot's refresh, about
ten minutes, plus the minute or two a KV write takes to spread, and nothing
stored in a grant can widen what it reads. An admin reads what an admin reads
on the site.

Machine keys are not accepted at `/mcp`. Bots keep reading over HTTP with
their keys.

### Documents in R2, search in AI Search

**The Worker publishes the documents to R2 itself.** The build lists every
document with a Markdown projection and one class — short ID, title, Markdown
address, modified time, and a hash of projection, class and title — in the
access map, with a digest of the list. On a schedule, every five minutes, the
Worker compares that digest with the one it last published, kept in a
marker object in the bucket itself, so that it describes that bucket and no
other. When they differ, it writes each document whose hash the
bucket does not hold, from the projection in its own assets, to the
deployment's private bucket as `docs/<short ID>.md` with its class, title,
short ID, Markdown address, modified time and hash as object metadata;
deletes the objects of documents that are gone; and starts an AI Search sync,
trying again on the next run while an earlier sync is still running. A
document it cannot write yet is tried again on the next run without holding
back the others. A
rollback is published the same way, because its digest differs, so the
bucket always follows the version that serves. No credential leaves
Cloudflare for this: the deploy job is unchanged.

**AI Search indexes that bucket**: one instance per environment, hybrid
search, `class`, `title` and `short_id` as its custom metadata fields, and a
15-minute sync interval as a backstop for a sync the Worker could not start.

**The Worker's own access map still decides.** AI Search is asked with a
filter on the reader's classes. Every result, and every document `fetch`
reads from the bucket, is judged again by the build's own list, never by what
the bucket says of it: a short ID the build does not list does not exist, its
class is the one the build's map gives its Markdown address, and `fetch`
returns an object only while its hash is the build's. A bucket or an index
that lags a deploy, or still holds a newer build's text after a rollback, can
therefore hide a document for a while, never open one.

This copy in R2 is the first step of moving generated content out of Git.
Building the site itself from R2 is a later decision.

### Tools

Two read-only tools, in the shapes ChatGPT requires, with `readOnlyHint`, a
title, and descriptions built from the site's name and description so that an
assistant knows when to use them:

- `search` — a `query` in; `{ results: [{ id, title, url }] }` out, one entry
  per document, best first, and none below a minimum relevance score, so a
  question the reader's documents do not answer gets no results rather than
  a near miss;
- `fetch` — an `id` in; `{ id, title, text, url, metadata }` out: the
  document's Markdown projection as `text`, and when it was last changed in
  `metadata`.

`id` is the document's short ID (ADR-022), and `url` its permanent link
`https://<host>/d/<short ID>/`, so a citation survives a rename. Results are
returned as `structuredContent` and as the same JSON in a text item. Neither
tool ever shows a document its reader cannot open. A document longer than
about 100,000 characters is cut there, and `metadata` says so.

The tools are served by the MCP TypeScript SDK's server package
(`@modelcontextprotocol/server` 2.3), whose `createMcpHandler` answers each
request statelessly on any web-standard runtime, rather than by the Agents
SDK the spike used, so that no Cloudflare package sits between the gate and
the tools. It needs at least 2.1, which bounds the body of a request to
`/mcp` at 4 MiB and a batch at 100 messages. The SDK takes the tools'
schemas in `zod`. With the OAuth library, these are the three production
dependencies the server adds.

### Configuration and checks

**An `mcp` section switches the server on.** Turned off, the Worker serves
no MCP or OAuth route, and the bindings may stay. It requires `signIn` and a
gated deployment. Validation then requires the `OAUTH_KV` namespace, the R2
bucket and AI Search bindings, and the `global_fetch_strictly_public`
compatibility flag the library needs to read client metadata documents, and
the five-minute publishing schedule.
Deploying with these bindings needs no permission beyond the deploy token's.
Setting up a deployment creates the account's AI Search service token once,
then the instance with its metadata fields.

The access smoke test and the scheduled probe check that `/mcp` answers an
anonymous request with `401` and a pointer to the metadata. Right after a
deploy the server must answer; after a rollback, or on the schedule before a
deploy, a version without it may refuse the request as any other write. The denial suite
publishes the build into a bucket in memory and asks both tools, as each of
its readers, for every document, against an index that returns everything.
The Worker logs each tool call by tool and outcome only. Search keeps chunks
scoring at least 0.4, a first value to tune with the real corpus.

## Consequences

### Positive

- Anyone in the Workspace reaches the knowledge base from claude.ai, ChatGPT,
  Claude Code or Cursor with one address and one Google sign-in, from any
  account.
- An assistant sees what its reader may read, and stops seeing it when their
  groups change or they leave.
- Search matches meaning as well as words, with no index to build or ship
  with the site.
- ChatGPT's company knowledge and deep research can use the corpus, citing
  permanent links.
- Content starts living in R2, the first step away from content in Git.

### Negative

- An OAuth authorization server is ours to keep working; the library carries
  the protocol.
- The OAuth library, R2 and AI Search are Cloudflare's. Moving host means
  replacing them, beyond ADR-038's four adapters.
- AI Search is in beta and its price is not announced. `search` keeps its own
  interface, so a plain keyword index over the same bucket can replace it.
- The bucket follows a deploy within the five-minute schedule, and search
  follows the bucket once AI Search has synced. `fetch` reads the bucket.
- People connect again every 30 days. Signing out of the site does not
  disconnect an assistant; a departure or a group change does.
- What an assistant has read stays in that assistant's history.
- Three more bindings per environment: a KV namespace, an R2 bucket and an AI
  Search instance.

### Follow-up

- The spike did not run long enough to see an assistant refresh its token
  (an hour). Refresh rotation is tested locally; watch each assistant's first
  refresh after the release.
- Tune the minimum relevance score with the real corpus.
- A `browse` tool, by folder, if people ask for it.
- A rate limit for readers and machine keys, if abuse appears.
- Moving generated content from Git to R2, in its own ADR.
