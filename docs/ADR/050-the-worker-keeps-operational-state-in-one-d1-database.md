# ADR-050: The Worker keeps operational state in one D1 database

- Status: Accepted
- Date: 2026-10-11
- Owners: CTCDocs maintainers
- Supersedes: the "no database" clause of the product invariant in
  `AGENTS.md`, in part

## Context

`AGENTS.md` forbids server-side rendering, a database and an LLM content
transformation. The Worker's state is the directory snapshot, the groups'
pins and the machine keys in KV, and, with the MCP server on, the OAuth
library's KV namespace and a copy of each document in R2.

The next features need state the Worker can write, read back and change:

- **A record of what people and assistants ask** (ADR-051), kept 90 days and
  aggregated weekly, so editors see what the documentation fails to answer.
- **Later:** the status of each gap found that way (open, assigned, resolved),
  owners and review dates for documents, and feedback assistants send on a
  page. KV cannot hold them: it has no append and is eventually consistent,
  so concurrent writes overwrite each other.

The alternatives were compared in a deployment's research. Workers Analytics
Engine is the best append-only store, but it is read only over HTTP with an
account-wide analytics token and holds no state that changes. R2 objects per
event, Pipelines, R2 SQL, Queues, Workers Logs and Logpush each add a product,
a secret or code without giving changeable state. D1 is SQLite behind a
binding: no secret, real SQL, local tests through Miniflare, and within the
included allowance at a documentation site's volume (Workers Paid includes 50
million rows written and 25 billion rows read a month, and 5 GB).

## Decision

**The Worker may keep operational state in one D1 database per deployment,**
bound as `KB_STATE_DB`. Operational state means:

- records of use: what was asked, by which class of reader, through which
  client, with what result;
- editors' workflow state: the status of a gap, a document's owner or review
  date, feedback on a page.

**The boundaries stay where they were:**

- **Never document content.** No document text, title list or rendered page
  is stored in or served from the database. The site stays static, built from
  the generated corpus; R2 stays the clean copy assistants' search indexes.
- **Never an access decision.** Who may read a file is decided by the build's
  access map on every request. Nothing read from the database admits a reader
  to anything, and a row naming a class never widens what that class reads.
- **Never a reader's identity.** The rule that no reader's address, ID or
  group membership is logged applies to the database as to logs: a record of
  use names an access class, not a person. Workflow state may name the admin
  or editor who set it, because that is the state itself.
- **Never in the request's path.** A write that fails is dropped and logged as
  an event; it never fails or slows the response to a reader or an assistant.
  Writes happen in `waitUntil`.

**The platform owns the schema.** It ships SQL migrations in
`packages/astro/worker/state/migrations/`, numbered and append-only. A
deployment's deploy workflow applies them with `wrangler d1 migrations apply
--remote` before `wrangler deploy`. `ctcdocs-sync validate` fails if a feature
that needs the database is on and `wrangler.jsonc` lacks the binding. A
deployment that turns no such feature on needs no database.

**Retention is the platform's code.** Each kind of record declares how long it
is kept, and the Worker's existing five-minute cron deletes what is older.
Deleted rows stay recoverable through D1's Time Travel for 30 days; the
documented retention of a record is its own line plus those 30 days.

**Cloudflare stays at the edge of the code.** The database is reached through
a small interface the Worker's entry files implement with the D1 binding, as
the bucket and the index are, so the rest of the Worker is web-standard and
testable with an in-memory implementation.

## Consequences

### Positive

- Features that need changeable state have a place, with no secret and real
  SQL.
- The rules that made the site safe hold: static pages, the access map decides,
  no reader identities.
- Tests run against SQLite locally, not against a mock of an analytics API.

### Negative

- The Worker is now an application with state: a schema, migrations to apply
  on every deploy, and a database to create in every deployment that uses it.
- Retention is code that can break silently; a test and a log event must
  show it runs.
- Writes go to one primary region. Fine for records written in the
  background; a feature that would read state in the request's path must
  measure its latency first.
- Time Travel keeps deleted rows 30 more days than a record's own line.
- A database invites growth. The boundaries above are the review rule.

### Follow-up

- ADR-051 is the first feature to use it.
- `AGENTS.md` states the new invariant; the review rules flag content,
  access decisions or reader identities in the database.
- Deployment documentation: creating the database, the binding and the
  migration step.
