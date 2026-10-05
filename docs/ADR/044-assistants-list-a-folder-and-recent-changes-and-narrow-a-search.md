# ADR-044: Assistants list a folder and recent changes, and narrow a search

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: ADR-042 in part, once accepted: the MCP server serves four
  tools, not two; a search shows whole chunks in the index's order and
  lists the other documents it finds, instead of cutting a passage of each;
  and a note is a field of the answer, not a text item beside it

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
- **A tree takes a call a folder, and a list repeats itself.** `browse`
  listed one level, so the same review took four calls to see which folders
  under one held documents of a kind. Each folder repeated its parents' path
  and each document its whole link and a time to the millisecond, which a
  tree and one pattern for the links say once.
- **Clients give the model different parts of an answer.** Claude Desktop
  gives the model a tool result's text and drops its structured content;
  Claude Code, when both are present, gives it the structured content alone
  (<https://github.com/anthropics/claude-code/issues/55677>). A note sent as
  a text item after the JSON, as `search` and `browse` sent theirs, never
  reached the model in Claude Code.

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

- **`browse`** lists a folder as a tree, within a budget: its documents and
  its folders, and the folders in those as deep as the project's
  `mcp.browseCharacters` of JSON allow: 24,000 unless it sets another, about
  6,000 tokens, the budget a search's passages take. Without a
  folder it lists the corpus root, so a small corpus is listed whole in one
  call. Each folder carries the number of documents under it the reader may
  open, and is either listed, with its documents and folders, or collapsed,
  with its name and count alone.
- **`recent`** lists the documents most recently changed in Drive, newest
  first: `mcp.recent.defaultResults` unless the call asks for up to
  `mcp.recent.results`, twenty and fifty unless the project sets others,
  optionally since a
  date and under a folder.

`recent` lists each document with `id`, `title`, `url`, `path` and
`modified`, as a search result does without its passages, so `fetch` reads
it. `browse` lists each with `id`, `title` and the day it last changed: its
folders are where it sits in the tree, and its link is the answer's `links`
pattern, with its id in place of `{id}`. Both are read-only and annotated so.

Neither calls AI Search. Both read the catalog in the access map and keep only
the documents the reader may open, by the rule `fetch` uses, stale directory
included. A folder exists for a reader only when it holds, directly or below,
a document they may open: neither tool names any other, and a folder no one
may read under looks as absent as one that does not exist.

### A tree is listed level by level

What is directly in the folder is listed first: its folders, collapsed, then
its documents, by title. When that alone does not fit, as many documents as
fit are listed, the rest are counted in `omitted`, and nothing below is
listed; the answer says to browse its folders or search within it. Otherwise
each level after lists more of the folders the level before listed: those
whose listing takes the fewest characters first, each whole or not at all,
while the budget holds. A folder left out stays collapsed, and the answer
says how many are and that browsing one by its path lists it. A large folder
is collapsed before many small ones, since its own `browse` lists it; a level
is never listed before the one above it. An optional `depth` caps the levels:
one lists only what is directly in the folder.

The budget, not a count of documents or levels, bounds the answer, since a
title or a folder name is as long as its author made it. The order of folders
and documents is by name, so an answer is the same for the same build and
reader. There is no cursor: a folder whose own documents do not fit is rare,
and search within it finds what the list leaves out.

### The numbers are the project's

The budget of a tree and the counts `recent` lists are settings of the
project's `mcp` section, as ADR-042 made every number of `search` and
`fetch`: `browseCharacters`, and `recent.defaultResults` and `recent.results`,
each optional and checked. The build writes the resolved values into the
access map, and the Worker holds no number of its own, so a project that
wants a larger tree changes its configuration and deploys, with no release of
the platform. The forty short IDs a narrowed search sends at most stay a
constant: they are AI Search's undocumented limit, which a setting could only
break.

### Notes are part of the answer

Every tool answers with one value, as JSON text and as structured content
alike. A note for the assistant, such as why a search found nothing, why a
folder is not there, or what a tree collapsed, is a `note` field of that
value, not a text item of its own, so every client gives it to the model.

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

### Whole chunks above, the other documents below

A measurement that counted answers shown, not only documents found (below),
found two faults in how ADR-042 cut passages. A passage kept the middle of
its chunk, which only means something when neighbouring chunks surround the
match; with none, an answer at the edge of a chunk was cut away. And the
budget went breadth first, every document's first passage before any second
one, so ten first passages of 2,400 characters spent it: a second passage
almost never showed, and the second chunk of the document ranked first,
which held the answer, was the one left out. Of 29 questions whose answer
document was among the first ten, six showed no answer.

A search no longer cuts. It takes the chunks that count in the order the
index ranked them, across documents, and shows each whole while the budget
holds, at most `passagesPerResult` of one document; a chunk that does not
fit is left out, never cut, and a smaller one ranked after it may still fit. A
chunk whose text a shown chunk of its document already holds, as neighbouring
chunks joined to a match can, is shown once.
Every other document found is listed without text, by id, title, link,
folders and date, and `morePassages` counts each document's matching chunks
left out. The order of the index gives the strongest documents most of the
text without a rule of its own, and a document ranked ninth costs a line, not
a share. `results` lists 15 documents unless the project sets another, and
`passageCharacters` takes 1,000 or more, no longer 100 for each result: the
budget answers to the size of a chunk, and a result it cannot hold is listed
without text.

A question answered by one or two documents is answered by their chunks; one
that needs many gets their list, to read with `fetch`. The server does not
guess which a question is: the assistant does, and `limit` and `compact` let
it ask for less. Nothing here reads a score of the index or calls a model:
the search needs only chunks in ranked order with their text and document,
which any index returns, so moving off AI Search changes none of it.

A chunk is the unit an assistant reads, so the instance's chunk size decides
how many fit the budget: about seven of AI Search's default 1,024 tokens,
about fifteen of 512, each under the 512 tokens the reranker reads of a chunk.
Measured on one deployment's corpus of about 140 documents in English and
Russian, with each answerable question naming words its answer holds:

| Search                                        | Answers shown | MRR   | Recall of the list | Documents with text |
| --------------------------------------------- | ------------- | ----- | ------------------ | ------------------- |
| Passages cut to a share, ten documents        | 23 of 32      | 0.721 | 0.859              | 10                  |
| Whole chunks, 1,024 tokens, fifteen documents | 25            | 0.724 | 0.916              | 7.5                 |
| Whole chunks, 800 tokens, fifteen documents   | 25            | 0.761 | 0.916              | 8.6                 |
| Whole chunks, 512 tokens, fifteen documents   | 25            | 0.724 | 0.893              | 10.8                |

On 512-token chunks the English questions ranked better and the Russian ones
worse (MRR 0.861 and 0.549, against 0.792 and 0.636), as ADR-042 found; on
800-token chunks the English ones ranked as on 512 and the Russian ones as on
1,024 (0.863 and 0.630). Two runs of the same 512-token instance differed by
an answer and by 0.03 of recall, which is the noise of one corpus and one
person's questions. The chunk size is the instance's setting, a project's
choice, which this record does not change.

### Every tool says the same things the same way

The four tools describe a document with the same fields, in the same form:

- **A day, `YYYY-MM-DD`**, for when it last changed, in `search`, `browse`
  and `fetch`: the milliseconds of Drive's time cost every entry fourteen
  characters and tell an assistant nothing. `recent`, whose order is the
  time and which answers what changed today, gives it to the minute in UTC,
  `YYYY-MM-DDTHH:MMZ`. `changedSince` still takes either.
- **`characters`**, the length of the text `fetch` returns, on every document
  each tool lists, and in `fetch`'s metadata the length of the whole text
  however much of it was returned. Characters of the Markdown, not bytes of
  the Google Doc or PDF: they are what `fetchCharacters` cuts by and what an
  assistant pays to read, so it can tell a short document it should read
  whole from a long one it should search within, and what reading ten of
  them costs. The build counts them from the text it publishes.
- **`format`**, `doc` or `pdf`, and a PDF's `pages` when the sync counted
  them, in `fetch`'s metadata, which the build reads from each document's
  page.
- **A link on every entry** of `search`, `recent` and `fetch`, as ChatGPT's
  shape asks of the first and the last and as `recent` lists what a compact
  search does; `browse`, the one long list, gives a pattern once.

`fetch` puts `metadata` before `text`, so an assistant reads where a document
sits, how long it is and whether it was cut before up to `fetchCharacters`
of its text; ChatGPT's shape fixes the fields, not their order. An unknown id
says to find one with `search`, `browse` or `recent`, and says it for this
person, which tells no one whether a document they may not open exists.

### A project measures its search with the platform's own

A project chooses its search settings by measuring them against its own
questions (ADR-042), so the measurement must rank and cut exactly as the
Worker does. `ctcdocs-eval-search`
([`packages/astro/bin/eval-search.mjs`](../../packages/astro/bin/eval-search.mjs))
calls the project's AI Search instance through the Worker's own
`searchDocuments`, with the settings of the project's last build, as a member
and as an admin, and under variants that each change one setting. A copy of
the Worker's ranking in a project falls behind the Worker; this one cannot.

The questions and the results are the project's, never the platform's: a
project keeps `evaluation/search-questions.json` and writes each run to
`evaluation/results/<date>-<label>/`. A question names the document that
answers it and every one it needs, and may name words the answer holds, so a
run tells a document found from an answer shown: whether the passages an
assistant reads of the documents the question needs hold the answer, which is
what the choice of passages decides. Another document that happens to hold
the words does not count.
A run writes document IDs, scores and lengths, never document text.

### Descriptions and instructions

Each tool's description says what it returns; `search` names the project's
`results` rather than ten. The server's instructions add that a question
asking for every document of a kind, or for what is new, is answered by
`browse`, which lists a tree, and `recent`, that a search can be kept to a folder or a date, and
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
- A small corpus is listed whole by one `browse`, and a large one as deep as
  the budget allows, the large folders collapsed for a call of their own.
- An answer's note reaches the model in every client.
- An assistant knows what a document costs to read before it reads it, and
  reads the same date in the same form from every tool.
- A question about which documents exist costs a compact search, a few
  hundred characters a document, instead of the whole passage budget.
- A passage is a whole chunk: an answer at its edge is not cut away, and
  nothing is cut that an assistant would not know of, since `morePassages`
  counts what was left out.
- A question needing many documents gets fifteen to choose from at the cost
  of a line each, and a weak document ranked above a needed one no longer
  takes its text.

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
- Fewer documents show text: about seven on 1,024-token chunks, where ten
  showed cut passages before; the rest show only their titles.
- A chunk longer than what is left of the budget is left out even when its
  document ranked first; a budget smaller than a chunk shows no text at all.
- An assistant builds a document's link from `browse`'s pattern, which it
  may get wrong; `fetch` and `search` still return each link whole.
- Which folders a tree collapses depends on how long their titles are, not
  on which matter more to the question.

### Follow-up

- Verify in ChatGPT's chat and company knowledge that the tools are offered
  and called, and that deep research still calls `search` with a query alone.
- Measure the questions that ask for every document of a kind with `browse`,
  against `search` alone.
- Measure an instance of 800-token chunks against 512 and 1,024 on the
  answers shown, the English and the Russian questions apart, before
  recommending a chunk size to projects.
- A window of a chunk around the words of the query, for a chunk longer than
  the budget, if chunks that do not fit turn out to cost answers. It is
  cheap and calls no model, but it is a cut, and a query in another language
  than the document finds no words to centre on.
- Mark ADR-042 superseded in part when this record is accepted.
- Raise forty if AI Search's keyword search comes to take more values. It is
  AI Search's limit, not a project's choice, so it is not a setting.
