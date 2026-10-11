# ADR-051: Content health shows what people and assistants could not find

- Status: Proposed
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

| Column       | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `at`         | Time, ISO 8601 UTC                                                                  |
| `tool`       | `search`, `fetch`, `browse` or `recent`                                             |
| `query`      | `search`'s query, at most 200 characters; null for the others                       |
| `class`      | The reader's access class, as the access map names it; never the reader             |
| `client`     | The OAuth client's name, at most 64 characters of letters, digits, spaces and `.-_` |
| `results`    | Documents returned                                                                  |
| `top_score`  | The best reranker score among them; null when there is none                         |
| `documents`  | JSON array of the first five short IDs returned                                     |
| `fetched`    | The short ID `fetch` read; null for the others                                      |
| `characters` | Characters of the answer's text                                                     |
| `latency_ms` | From the call's start to its answer                                                 |
| `stale`      | Whether the directory snapshot was stale                                            |

**One row per settled site search**, from the second step (table
`site_searches`):

| Column    | Meaning                                      |
| --------- | -------------------------------------------- |
| `at`      | Time                                         |
| `query`   | The query, at most 200 characters            |
| `class`   | The reader's access class                    |
| `results` | Results Pagefind showed                      |
| `opened`  | The page the reader opened from them, if any |

A search is settled after 1.5 seconds without typing, or when a result is
opened. The page sends it with `navigator.sendBeacon` to
`POST /_kb/insights/search`. The Worker:

- accepts it only from a signed-in reader;
- takes the class from the session, never from the body;
- keeps at most 30 a minute per session in memory.

**Both are kept 90 days.** The five-minute cron deletes older rows (ADR-050:
Time Travel keeps them 30 days more).

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

A CLI, `ctcdocs-insights`, prints the same report from the database for
maintainers, and can write the week's misses as candidate questions for a
deployment's evaluation set.

### Configuration

`insights.enabled` turns it on, and needs `mcp.enabled` and the `KB_STATE_DB`
binding. Optional settings:

- `insights.retentionDays`: 90 by default, at most 365;
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
- Grouping by words is crude across languages: the same question in two
  languages forms two groups.
- The first week's "weak" line is relative, not a measured threshold.
- A deployment gains a database, a binding and a migration step.

### Follow-up

- **Gap status** (open, assigned, resolved) in a `gaps` table, once editors
  use the list.
- **Grouping by embeddings**, if word groups split one question too often.
