# ADR-044: Assistants list a folder and recent changes, and narrow a search

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: ADR-042 in part, once accepted: the MCP server serves four
  tools, not two, and a passage's share of the budget follows the documents
  a search finds

## Context

ADR-042 gave the MCP server two tools: `search`, which ranks documents by
meaning and returns ten, and `fetch`, which reads one. A question that asks
for everything of a kind, or for what is new, is not a question of meaning:

- **Lists are cut at ten, and ranked by similarity.** In the first
  measurement (ADR-042), a question asking for every document of a kind found
  four of the seven it needed, and one asking for ten found all ten only at
  the edge of the results.
- **Nothing answers "what changed".** A search for recent changes ranks
  documents that talk about change.
- **Nothing narrows a search to where the answer is.** A reader who knows the
  answer sits under a folder, or is recent, cannot say so.
- **Every search costs the whole budget, and still cuts.** An assistant's
  review of a session found ten results with their passages too much context
  for a question that needed only which documents exist, with no way to ask
  for fewer or for titles alone. And a passage was cut at a tenth of the
  budget however few documents a search found, so a list in a matching chunk
  ended mid-item and the assistant read the whole document for one line.

ADR-041 notes a `browse` tool for when people ask for it, and ADR-042's
follow-ups name the rest: tools to list a folder and recent changes, and
optional `search` parameters for a folder and a modified-after date, for chat
clients, with no more than four or five tools in all.

**What the clients require.** ChatGPT's deep research uses only `search` and
`fetch`, in the shapes OpenAI fixes; its chat and company knowledge may call
other read-only tools (<https://developers.openai.com/api/docs/mcp>). Claude
and other clients call any tool the server lists. Tool selection degrades
with dozens of tools, not with four (ADR-042).

**What AI Search can filter.** Filters apply before retrieval, on metadata
fields, with `$eq`, `$ne`, `$in`, `$nin` and ranges, all of them combined by
AND. A filter's JSON is under 2,048 bytes, only the first 64 bytes of a
string are filterable, and an instance has at most five custom fields, three
of them used (`class`, `title`, `short_id`); changing them reindexes every
document
(<https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/>,
<https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/>,
<https://developers.cloudflare.com/vectorize/reference/metadata-filtering/>).
A folder path in 64 bytes does not survive deep folders or non-Latin names,
and the built-in `folder` attribute is the object key's, flat by design
(ADR-041).

Measured on a deployment's instance, a filter by `short_id` with `$in` or
`$nin` narrows both search methods up to 40 values. With 41 to 100, a hybrid
search answers but runs vector search alone: its keyword search refuses more
than 40 values, and the response says so only in `hybrid_meta`. With more
than 100 the request fails. None of these limits is documented. The same
holds for the class filter `search` has always sent: a reader who may read
more than 40 classes lost keyword search on every search, silently.

**What the Worker already holds.** The access map the Worker is bundled with
lists every document the MCP server offers, with its folders, from the corpus
root, and when it last changed in Drive (ADR-042). The Worker judges every
document against the reader with it.

## Decision

### Two more tools, from the build's catalog

- **`browse`** lists a folder: the folders directly in it, each with the
  number of documents under it the reader may open, and the documents
  directly in it, a hundred at most, saying how many more there are. Without
  a folder it lists the corpus root.
- **`recent`** lists the documents most recently changed in Drive, newest
  first: twenty unless the call asks for up to fifty, optionally since a
  date and under a folder.

Each document they list carries `id`, `title`, `url`, `path` and `modified`,
as a search result does without its passages, so `fetch` reads it. Both are
read-only and annotated so.

Neither calls AI Search. Both read the catalog in the access map and keep only
the documents the reader may open, by the rule `fetch` uses, stale directory
included. A folder exists for a reader only when it holds, directly or below,
a document they may open: neither tool names any other, and a folder no one
may read under looks as absent as one that does not exist.

### A folder is named by its path

A folder is the path `search` and `fetch` already return: the folder labels
from the corpus root, as a list. A request may pass that list, which means
exactly those folders, or one string, the labels joined by a slash with a
space on each side, as results print it. A request matches segment by
segment, ignoring case and surrounding spaces. A folder's own name may hold a
slash, bare or spaced, so a string is also read split on a bare slash, and
whole, when a reading before names no folder; the list is the unambiguous
form. Folder labels are what readers see on the site; the Drive identifiers
behind them never reach an assistant. Two sibling folders with the same label
are one folder to an assistant.

### `search` may be narrowed

`search` takes two optional parameters besides `query`: `folder`, which keeps
documents under that folder, and `changedSince`, which keeps documents changed
in Drive on or after a date (`YYYY-MM-DD`, or a date and time in UTC). A
date the calendar does not have, such as 30 February, is refused rather than
rolled into the next month. A document without a Drive time does not match
`changedSince`.

The Worker turns them into a filter AI Search applies before retrieval,
without a new metadata field and without reindexing. From the catalog it
takes the documents the reader may open that match. When none do, the search
returns nothing. When few do, it asks only for them, by `short_id` with
`$in`; when few do not, it excludes those, with `$nin`; at most 40 short IDs
either way, so that keyword search still runs. When neither is few, it asks
without them.

One function builds every search's filter within AI Search's limits. A
reader of every class needs no class filter. Otherwise the reader's classes
go as `$in` when they are 40 or fewer, or as `$nin` of the other classes when
those are. When neither side is, keyword search gives way to whichever side
is a hundred or fewer, the reader's first; when neither is, no class filter is
sent, since a list past a hundred fails the search. When the whole filter's
compact JSON would reach 2,048 bytes, the narrowing is left out first, then
the classes. No part of the filter decides access, so
leaving one out ranks more of what the reader cannot see and never shows it.

In every case the Worker keeps, as before, only chunks of documents the reader
may open, and now only those that match. A narrowed search finds no document a
plain one would not show the same reader.

### `search` may return less

`search` takes two more optional parameters: `limit`, the most documents it
returns, from one to the project's `results`, and `compact`, which returns
each document's `id`, `title`, `url`, `path` and `modified` without `text`,
as `browse` and `recent` list documents. A document counts toward the limit
only once a chunk of it has passed the same judgment as before, and a compact
search finds a document only through such a chunk, so neither shows anything
a full search would not show the same reader. ChatGPT's shape for a search
result needs only `id`, `title` and `url`, so `text` becomes optional.

A passage's share of the budget is the budget divided by the documents a
search found, not by the most it may return: two documents found share the
24,000 characters ten would, and a passage is cut only where a chunk is longer
than its share. The budget, the passages per document and the breadth-first
order stay as ADR-042 set them.

### Descriptions and instructions

Each tool's description says what it returns; `search` names the project's
`results` rather than ten. The server's instructions add that a question
asking for every document of a kind, or for what is new, is answered by
`browse` and `recent`, that a search can be kept to a folder or a date, and
that a compact search shows which documents match without their passages.

## Consequences

### Positive

- An assistant can list everything under a folder, and say what changed,
  instead of ranking documents by how close they read to the question.
- A search can be kept to where the answer is, which ranks the right
  documents among fewer.
- Nothing is reindexed and no AI Search setting changes: the folder and date
  come from the build, as access does.
- No tool names a folder or a document the reader may not open.
- A question about which documents exist costs a compact search, a few
  hundred characters a document, instead of the whole passage budget.
- A search that finds few documents shows their passages whole, up to the
  chunk, instead of cutting each at a tenth of the budget.

### Negative

- Four tools instead of two, each described in every session's context.
- A renamed folder changes its path: an assistant that kept the old path finds
  nothing until it browses again.
- When a narrowed search matches neither few nor nearly all documents, AI
  Search ranks the whole readable corpus and the Worker discards what does
  not match, so fewer than ten results may come back.
- `changedSince` and `recent` know Drive's time, which a typo fix moves as
  much as a rewrite.
- ChatGPT has not been seen calling the new tools or the optional parameters.
- A search that finds few documents returns more characters than before,
  still within the budget.

### Follow-up

- Verify in ChatGPT's chat and company knowledge that the tools are offered
  and called, and that deep research still calls `search` with a query alone.
- Measure the questions that ask for every document of a kind with `browse`,
  against `search` alone.
- Mark ADR-042 superseded in part when this record is accepted.
- Make the limits (twenty, fifty, a hundred, forty) project settings if a
  corpus needs others, and raise forty if AI Search's keyword search comes to
  take more values.
