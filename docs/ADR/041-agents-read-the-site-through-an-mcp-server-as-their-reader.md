# ADR-041: Agents read the site through an MCP server, as their reader

- Status: Proposed
- Date: 2026-10-03
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

People want the knowledge base inside the AI assistants they already use —
claude.ai and ChatGPT first — and they must see there exactly what they may
read on the site: the same folders, the same groups, the same end when they
leave (ADR-038, ADR-039, ADR-040).

Both assistants connect to remote servers that speak the Model Context
Protocol over Streamable HTTP, from their own infrastructure, and sign the
person in with OAuth. As of this decision:

- The MCP authorization specification makes the MCP server an OAuth 2.1
  resource server that publishes Protected Resource Metadata (RFC 9728) and
  answers an unauthenticated request with `401` and a `WWW-Authenticate`
  challenge pointing at it. The authorization server publishes RFC 8414
  metadata, requires PKCE with S256, binds every token to one resource
  (RFC 8707), and should return `iss` in its authorization response
  (RFC 9207). A server must not accept a token issued for anything else, nor
  pass one on.
- Clients register by a Client ID Metadata Document (CIMD), preferred by both
  assistants, or by Dynamic Client Registration (DCR), which the latest
  revision deprecates but keeps, and which claude.ai falls back to.
- claude.ai redirects to `https://claude.ai/api/mcp/auth_callback`, calls
  from a published address range, and on Team and Enterprise plans an owner
  adds a connector once for the organization; each member then connects with
  their own account.
- ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect` when
  the authorization server meets RFC 9207. Its deep research and company
  knowledge modes require two read-only tools named `search` and `fetch`
  with fixed shapes.
- The protocol's latest revision is stateless; older clients still open with
  `initialize`. Neither needs a session on the server.
- Pagefind has no supported search outside a browser, and a Worker cannot
  instantiate WebAssembly from bytes, which Pagefind's runtime does.
- Cloudflare's `workers-oauth-provider` (1.2) implements the authorization
  and resource server roles in a Worker — CIMD, DCR, PKCE, RFC 9207, resource
  binding, rotating refresh tokens, hashed storage in Workers KV, encrypted
  per-grant properties — and leaves the sign-in and consent step to the
  application. Cloudflare's `createMcpHandler` serves stateless MCP without
  Durable Objects.

Machines that act for no person — a chat bot, an internal agent — already
read with machine keys (ADR-038). Agents can already read the Markdown
projections and `llms.txt`, but only with a key, and an assistant's chat
surface cannot add a header.

## Decision

### The server

**The deployment's Worker serves MCP at `/mcp`**, on the site's own hostname,
over stateless Streamable HTTP. It answers both the current revision and
clients that still open with `initialize`, and keeps no session. The tools
are read-only and carry `readOnlyHint` and a title:

- `search` — a query in, results out as `{ id, title, url }`, in the shape
  ChatGPT requires; the `url` is the document's page, so answers cite it;
- `fetch` — a document's `id` in, its Markdown projection out as
  `{ id, title, text, url, metadata }`, cut to the size the clients accept;
- `browse` — a folder's address in, its subfolders and documents out, so an
  assistant can follow the site's own order.

Every answer is decided by the same classes and the same snapshot as a page:
a document the reader may not open is neither found, fetched nor listed, and
a closed document's title appears only where a member would see it on the
site (ADR-039).

### Who is asking

**The Worker is the authorization server too**, with `workers-oauth-provider`
for the protocol. It publishes the metadata both documents name, advertises
CIMD and S256 and returns `iss`, and keeps its clients, grants and tokens in a
KV namespace of their own, which the deploy token cannot write.

**Signing in to an assistant is signing in to the site.** The authorization
step is ours:

1. it looks up the client, and refuses one whose redirect URI is not on the
   deployment's allow-list — by default the two assistants' callbacks and
   Claude Code's loopback;
2. it shows a consent page that names the client and its exact redirect URI,
   carries a CSRF token and cannot be framed;
3. it signs the reader in with Google through the existing client
   (ADR-038), or takes their live session, and requires the snapshot to list
   them as active (ADR-040);
4. it completes the grant with the reader's `sub` as its only property.

DCR stays on for claude.ai's fallback; the allow-list, the consent page and a
Workspace sign-in are what stand between a registered client and the corpus.

**Every MCP request is checked like a session.** The token must be ours,
unexpired and bound to this server's `/mcp`. Its `sub` must be an active user
in the snapshot, and its groups come from the snapshot at that moment, not
from the grant: a change of groups takes effect within the snapshot's ten
minutes, a departure ends every grant at once, and a stale snapshot serves
the members class only. An admin reads everything, as on the site. Access
tokens live an hour and refresh tokens rotate; a grant lasts as long as the
library's default allows and is revoked by the client's revocation request or
by an admin.

**Machine keys work at `/mcp` too**, as the groups they were issued, never as
an admin, so a bot uses the same tools as an assistant.

### Search

**The build writes a search index per class** for the server, the way it
writes a Pagefind bundle per class for the browser: titles, headings and body
text of that class's documents, as a prebuilt MiniSearch index under
`/_kb/mcp/`. The access map classifies each index as its class, so the gate
refuses one to anyone outside it. The Worker loads the indexes of the
reader's classes from the asset store, keeps them in memory for the life of
the isolate, and merges the results. The leak check covers these files as it
covers every other.

### Limits and records

**Requests are rate-limited per reader and per machine key** with Workers Rate
Limiting, which also delivers the limit ADR-038 deferred for machine keys.
**The Worker logs each tool call** by tool and outcome — never the query, the
reader, a document or a token.

### Environments and checks

**A deployment turns MCP on** with an `mcp` section in its configuration: the
switch and, optionally, the redirect allow-list. Validation then requires the
OAuth KV binding, the rate-limit binding and the compatibility flag the
library needs to fetch client metadata documents. The access smoke test
requires `/mcp` to answer an anonymous request with `401` and a challenge,
the metadata documents to be served, and a key's search to find a members
document and no narrower one. The denial suite asks the tools, as each of its
readers, for every document.

**An organization adds the connector once**: an owner on claude.ai Team or
Enterprise, an admin on ChatGPT Business or Enterprise, with the URL
`https://<host>/mcp` and the client's published identity (CIMD).

## Consequences

### Positive

- People reach the knowledge base from claude.ai and ChatGPT with their own
  Google account, and an assistant sees exactly what they may read, changing
  with their groups and ending when they leave.
- One identity layer serves the browser, the assistants and the bots.
- ChatGPT's deep research and company knowledge can use the corpus, with
  citations to the site.
- Machine keys gain a rate limit, which ADR-038 left open.

### Negative

- The perimeter grows by an OAuth authorization server: registration,
  consent, codes, refresh and revocation are ours to keep correct. The
  library carries the protocol; our consent and sign-in step does not have
  that cover.
- The authorization server is a Cloudflare library on Workers KV. ADR-038's
  core stays portable — the tools and the access decisions use web standards
  — but moving host means replacing this piece with another OAuth server.
- DCR lets anyone register a client. The redirect allow-list and the consent
  page answer that; a new assistant needs the allow-list changed.
- A server-side index per class is another copy of each class's text in the
  build, and more to keep inside its class.
- Grants outlive sessions: a connected assistant keeps reading for as long as
  its grant lasts, until the reader leaves, is removed from a group, or the
  grant is revoked. Sign-out on the site does not end it.
- Two more bindings — a KV namespace and a rate limiter — and two assistants'
  behaviour to follow as their connector platforms change names and rules.

### Follow-up

- A spike, before implementation: a minimal Worker with the library, our
  Google sign-in and consent, and `createMcpHandler`, on a test hostname,
  connected from claude.ai and from ChatGPT with each client's published
  identity; record what each sends and whether refresh works.
- An admin view of a reader's grants, with revocation.
- Per-document rules (ADR-039) apply to the tools unchanged when they come.
- Document adding the connector in each assistant, and the bots' use of
  machine keys, in the setup guide and the operations runbook.
