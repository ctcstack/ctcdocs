# ADR-044: Assistants list a folder and recent changes, and narrow a search

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: ADR-042 in part, once accepted: the MCP server serves four
  tools, not two

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
than 100 the request fails. None of these limits is documented.

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
from the corpus root, written as one string joined by a slash with a space on
each side. A request matches it segment by segment, ignoring case and
surrounding spaces. A folder's own name may hold a slash, so a path is split
on a spaced slash first, and on a bare one only when that reading names no
folder. Folder labels
are what readers see on the site; the Drive identifiers behind them never
reach an assistant. Two sibling folders with the same label are one folder to
an assistant.

### `search` may be narrowed

`search` takes two optional parameters besides `query`: `folder`, which keeps
documents under that folder, and `changedSince`, which keeps documents changed
in Drive on or after a date (`YYYY-MM-DD`, or a date and time in UTC). A
document without a Drive time does not match `changedSince`.

The Worker turns them into a filter AI Search applies before retrieval,
without a new metadata field and without reindexing. From the catalog it
takes the documents the reader may open that match. When none do, the search
returns nothing. When few do, it asks only for them, by `short_id` with
`$in`; when few do not, it excludes those, with `$nin`; at most 40 short IDs
either way, so that keyword search still runs. When neither is few, it asks
without them. In every case
the Worker keeps, as before, only chunks of documents the reader may open,
and now only those that match. A narrowed search finds no document a plain
one would not show the same reader.

### Descriptions and instructions

Each tool's description says what it returns. The server's instructions add
that a question asking for every document of a kind, or for what is new, is
answered by `browse` and `recent`, and that a search can be kept to a folder
or a date.

## Consequences

### Positive

- An assistant can list everything under a folder, and say what changed,
  instead of ranking documents by how close they read to the question.
- A search can be kept to where the answer is, which ranks the right
  documents among fewer.
- Nothing is reindexed and no AI Search setting changes: the folder and date
  come from the build, as access does.
- No tool names a folder or a document the reader may not open.

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

### Follow-up

- Verify in ChatGPT's chat and company knowledge that the tools are offered
  and called, and that deep research still calls `search` with a query alone.
- Measure the questions that ask for every document of a kind with `browse`,
  against `search` alone.
- Mark ADR-042 superseded in part when this record is accepted.
- Make the limits (twenty, fifty, a hundred, forty) project settings if a
  corpus needs others, and raise forty if AI Search's keyword search comes to
  take more values.
