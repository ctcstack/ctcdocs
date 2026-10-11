# ADR-051: Content health shows what people and assistants could not find

- Status: Accepted
- Date: 2026-10-11
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Nothing records what readers and assistants ask. Search quality is measured
only on a deployment's hand-written questions (ADR-042, ADR-044), and editors
learn what is missing only when someone complains. Every documentation
product that serves assistants reports this:

- GitBook turns questions into typed content gaps with evidence;
- Mintlify splits traffic by assistant and lists searches with no result;
- Document360 sorts unanswered queries into in and out of scope;
- Kapa clusters uncertain answers weekly.

ADR-050 gives the Worker a D1 database for records of use.

The product decisions behind this record:

- query text is recorded and kept 90 days;
- the report is for admins only;
- every admin of a deployment sees all of it;
- site searches follow MCP calls, as a second step.

## Decision

### What is recorded

**One row per MCP tool call**, written in `waitUntil` after the answer
(table `mcp_calls`):

| Column       | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `at`         | Time, ISO 8601 UTC                                                               |
| `tool`       | `search`, `fetch`, `browse` or `recent`                                          |
| `query`      | `search`'s query, at most 200 characters; null for the others                    |
| `narrowed`   | Whether the call kept itself to a folder, a date or a format                     |
| `classes`    | JSON array of the access classes the reader may read, sorted; never the reader   |
| `client`     | The name the client gave when it connected, as letters, digits, spaces and `.-_` |
| `results`    | Documents returned; for `browse`, those under the folder, as its count says      |
| `top_score`  | The best reranker score among the chunks that counted; null when there is none   |
| `documents`  | JSON array of the first five short IDs returned                                  |
| `fetched`    | The short ID `fetch` read; null for the others                                   |
| `characters` | Characters of the answer's text                                                  |
| `latency_ms` | From the call's start to its answer                                              |
| `stale`      | Whether the directory snapshot was stale                                         |

**Which classes a record names.** A reader reads a set of classes, not one:
the members class, and each restricted class one of their groups opens. A
record names that set as the access decision of the call reached it, so it
follows the directory as the answer does: while the snapshot is stale it is
the members class alone. An admin reads every class and is named by
`admins` alone. The set lets the report tell a miss every member has from one
only readers of some folders have. Its cost is under Consequences.

**The client** is the name the assistant gave when it connected, kept in its
grant. It is the client's own claim: it labels the report and decides
nothing. A grant from before this record has none.

**At most 60 calls a minute per person are recorded,** counted in memory in
each isolate. An assistant in a loop is answered as ever; its records past
the line are dropped, and the first dropped in a minute is logged, without
the person. Without the line one loop could fill the database, and its
bill, with copies of one call.

A call is recorded once its answer is made. A failed lookup, or a narrowing
the server could not read, is not an answer and is not recorded; `fetch` of
an id the reader may not open is, with no document and no id, since the id
asked for is the assistant's text.

**One row per settled site search**, from the second step (table
`site_searches`):

| Column    | Meaning                                      |
| --------- | -------------------------------------------- |
| `at`      | Time                                         |
| `query`   | The query, at most 200 characters            |
| `classes` | The access classes the reader may read       |
| `results` | Results Pagefind showed                      |
| `opened`  | The page the reader opened from them, if any |

A search is settled after 1.5 seconds without typing, or when a result is
opened. The page sends it with `navigator.sendBeacon` to
`POST /_kb/insights/search`. The Worker:

- accepts it only from a signed-in reader;
- takes the classes from the session, never from the body;
- keeps at most 30 a minute per session in memory.

**Both are kept 90 days.** The five-minute cron deletes older rows (ADR-050:
Time Travel keeps them 30 days more). It does so whenever the database is
bound, insights on or off, so turning them off never keeps records for good.
A weekly report quotes queries, so it goes when the first day it aggregates
does: it is kept a week less than the records.

### The weekly report

On the first cron run after Monday 00:00 UTC, the Worker aggregates the last
seven days and stores one row in `reports`: the week and the report as JSON.
The report holds:

- **What was not found.** MCP searches with no result, or a top score under
  `insights.weakScore`, and site searches with no result.
  - Grouped by their normalized words: lower case, punctuation and the
    language's stop words removed, sorted.
  - Two groups merge when their word sets overlap by half or more, or when
    their best document is the same.
  - Each group carries its queries, count, classes and clients, and the
    documents it nearly found.
  - Until a project sets `insights.weakScore`, "weak" is the lowest fifth of
    the week's top scores.
- **What is asked most:** the twenty largest groups of all searches.
- **Found, not read:** documents returned often whose `fetch` count is under a
  tenth of their appearances.
- **Use:**
  - calls by tool and by client;
  - median and 95th-percentile `search` latency;
  - median characters per answer;
  - share of searches not found (the C6 number).

**How it is made.** The choices the record above leaves open:

- **Once a week, made up if missed.** Each run of the schedule reports the
  week before, from Monday to Monday in UTC, unless that report is kept. A
  run that fails is made up by the next; two at once keep the first. A week
  with no record is not reported. Retention deletes first, so a week too
  heavy to report in one run never keeps a record past its line; with
  retention at least two weeks, it never takes what the report reads.
- **What is never a gap.** A search kept to a folder, a date or a format,
  and one with no word to group by, count in the use but never as not
  found, nor in the share: what it missed may be there.
- **Words.** English stop words are always dropped, since assistants often
  ask in English whatever the documents' language, and the documents'
  language's when the platform has a list for it (English and Russian
  first). Without one, a query groups by all its words.
- **Merging.** Word sets merge at a Jaccard similarity of one half. The
  same best document merges groups of what was not found only: among all
  searches it would join every question a popular document answers.
- **The relative weak line** is the lowest fifth of the week's scored
  searches, so a week with fewer than five has none; a search scoring as
  the fifth's last does is as weak.
- **Bounds.** Fifty groups of what was not found, the twenty asked most,
  ten queries and five documents a group, twenty documents found and not
  read, each returned at least five times. At most 50,000 records of each
  table are read, and the report says when a week held more, and how many
  records it could not read.
- **Names.** Documents by short ID, classes by the access map's names,
  clients by their labels: the queries are its only text, kept without
  control characters. `ctcdocs-insights` and the content health page show
  titles from the build.

### How editors see it

The Worker serves the latest report at `/_kb/insights.json` to admins only.
The route is decided like the access review page (ADR-045): admins, and no
one else, whatever the session holds. The content health page gets a section,
**What people could not find**, which the page fills in the browser from that
address.

- Admins see the groups ranked by count.
- Anyone else, and a deployment without the feature, sees nothing: the
  section is absent from the built page unless the feature is on, and empty
  unless the JSON loads.

The route answers as the admins class is read: not while the snapshot is
stale, and never to a machine key. Off, the feature answers an admin 404;
unbound, the database 503; with no week reported yet, a report of `null`.
Its answer names each document the report names by its title and permanent
link, from the build the Worker serves, so the stored report keeps no
title. The page sets every query as text, never as markup. Since only
admins read the report, `insights.enabled` needs `access.admins`.

A CLI, `ctcdocs-insights`, prints the same report from the database for
maintainers, and can write the week's misses as candidate questions for a
deployment's evaluation set. It reads through the project's Wrangler, as
the maintainer is signed in, and only reads: the kept report, or one made
from the week's records with `--compute` or when none is kept. Candidates
go to a file of their own, never into the evaluation set, since each needs
an editor to say which documents answer it.

### Configuration

`insights.enabled` turns it on, and needs `mcp.enabled` and the `KB_STATE_DB`
binding. Optional settings:

- `insights.retentionDays`: 90 by default, from 14 to 365, so that a report
  is kept at least the week after it is made;
- `insights.weakScore`: 0 to 1, unset by default;
- `insights.siteSearch`: whether site searches are recorded, `true` by
  default once the second step ships.

### Steps

One branch and pull request, committed in this order:

1. **Database plumbing.** Migration `0001`, the state interface with a D1 and
   an in-memory implementation, retention in the cron, and the
   `ctcdocs-sync validate` checks.
2. **MCP calls recorded.** Tests prove a row never names a reader, takes its
   class from the access decision, and that a failing write leaves the answer
   unchanged.
3. **Weekly report and `ctcdocs-insights`.**
4. **`/_kb/insights.json` and the content health section.** The denial suite
   asks for the report as every reader and expects only admins to get it.
5. **Site search beacon and `site_searches`.**
6. **Documentation:**
   - `CONFIGURATION.md`;
   - `DEPLOYMENT.md`: create the database, bind it, the migration step in
     `project-deploy.yml`;
   - CHANGELOG.

## Consequences

### Positive

- Editors see real gaps, ranked, without asking anyone.
- C3 (search latency), C4 (characters per answer) and C6 (share not found) get
  numbers every week.
- Real misses become evaluation questions.

### Negative

- Query text is stored, and may hold a name or a sensitive word. It is kept 90
  days (120 with Time Travel), and only admins read it.
- The classes a reader may read follow from their groups. In a small
  organization a rare set, with a time and a query, can point to a person.
  Only admins read it, and they already see who belongs to each group.
- Grouping by words is crude across languages: the same question in two
  languages forms two groups.
- The first week's "weak" line is relative, not a measured threshold.
- A deployment gains a database, a binding and a migration step.

### Follow-up

- **Gap status** (open, assigned, resolved) in a `gaps` table, once editors
  use the list.
- **Grouping by embeddings**, if word groups split one question too often.
