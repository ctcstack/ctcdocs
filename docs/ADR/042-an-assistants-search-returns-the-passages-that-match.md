# ADR-042: An assistant's search returns the passages that match

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: ADR-041 in part, once accepted: what `search` and `fetch`
  return, and the minimum relevance score

## Context

ADR-041 gave assistants two read-only tools in the shapes ChatGPT requires.
`search` asks AI Search for 30 chunks scoring at least 0.4, keeps one entry
per document the reader may open, and returns at most ten of them as an id, a
title and a link. `fetch` returns a document's Markdown projection, front
matter included, cut at 100,000 characters. Reading the code against the
documentation of the clients and of AI Search shows where this falls short:

- **An assistant judges a result by its title alone.** To learn whether a
  document answers the question it has to `fetch` it whole, up to about 25,000
  tokens each time, and AI Search's chunk text, which says why the document
  matched, is thrown away.
- **Exact terms are lost before they are ranked.** AI Search's
  `match_threshold` filters on vector similarity, not on the fused score it
  returns (<https://developers.cloudflare.com/ai-search/configuration/retrieval/result-controls/>).
  A chunk that matches a code name, an acronym or a product name word for
  word, but whose meaning is far from the question, never reaches the fusion
  that would rank it. Keyword matching also defaults to `and`: a chunk must
  contain every word of the query, so a question asked in a sentence gets
  little from BM25.
- **The front matter is noise.** `synced_at` and `content_hash` are sync
  bookkeeping. They open every text `fetch` returns and are indexed with each
  document's first chunk.
- **A long document hits the clients' limits.** Claude Code caps a tool
  result at 25,000 tokens and warns at 10,000; claude.ai and Claude Desktop
  at about 150,000 characters
  (<https://claude.com/docs/connectors/building/index.md>). 100,000 characters
  of English is about 25,000 tokens, and the result carries the text twice,
  as structured content and as JSON text.

**What the clients require.** OpenAI fixes the tools' names and shapes for
company knowledge and deep research: `search(query)` returning
`{ results: [{ id, title, url }] }` and `fetch(id)` returning
`{ id, title, text, url, metadata }`, both as structured content and as the
same JSON in a text item (<https://developers.openai.com/api/docs/mcp>). It
says nothing of other fields in a result. Deep research uses only these two
tools; company knowledge and chat may use other read-only ones. Claude's
directory asks for a title and a read-only hint on every tool, descriptions
that describe rather than instruct, actionable errors and reasonably sized
results (<https://claude.com/docs/connectors/building/review-criteria.md>).
MCP resources are chosen by the host, not called by the model; ChatGPT and
the Claude API's connector use tools only.

**What the vendors recommend.** Anthropic's guidance on tools for agents:
few, consolidated tools; high-signal results, with the matching lines and
some context around them; pagination and truncation with sensible defaults,
and a truncation message that says how to go on; errors that steer the next
call (<https://www.anthropic.com/engineering/writing-tools-for-agents>).
Better tool descriptions cut the time of its research agents' tasks by 40%
(<https://www.anthropic.com/engineering/built-multi-agent-research-system>).
Mature knowledge-base servers agree on a shape: Notion, Google Drive,
Microsoft Learn and Microsoft 365's retrieval API return passages with each
result, with its path or location and its date, and read a whole item with a
second call; most also filter by folder or date.

**What research shows.**

- **Iterative search beats one-shot retrieval**, and returns diminish after
  two or three rounds: IRCoT gains up to 21 points of recall
  (<https://arxiv.org/abs/2212.10509>); Search-R1 gains 20–41% over plain
  retrieval (<https://arxiv.org/abs/2503.09516>). Every such system returns
  passages from its search, not titles; reading a whole document is a
  separate action.
- **Passages, and a few of them.** Search-R1 did best with three passages a
  step, better than one and better than five. Removing short query-focused
  snippets cost Sieve 3–7 points and more calls
  (<https://arxiv.org/html/2608.02751>). In ReAct, searches that told the
  model nothing caused 23% of the errors
  (<https://arxiv.org/html/2210.03629>).
- **More context is not better context.** With the answer in the middle of
  twenty documents, GPT-3.5 fell below its score with no documents at all, and
  fifty documents added about 1.5% over twenty
  (<https://arxiv.org/abs/2307.03172>). Every one of eighteen models degrades
  as its input grows (<https://www.trychroma.com/research/context-rot>);
  adding retrieved passages follows an inverted U
  (<https://arxiv.org/abs/2410.05983>).
- **Hybrid retrieval and reranking are the dependable levers.** Anthropic's
  Contextual Retrieval took failed retrievals from 5.7% to 2.9% with
  contextual embeddings and BM25, and to 1.9% with a reranker
  (<https://www.anthropic.com/news/contextual-retrieval>). On enterprise data
  BM25 alone beat vector search, 68.8% to 51.4%, because internal code names
  and acronyms defeat embeddings (<https://arxiv.org/html/2605.05253v1>).
- **Reading by section is more accurate and cheaper than reading whole long
  documents** (DeepRead, <https://arxiv.org/html/2602.05014v3>; Sieve), as a
  100-line window beat a whole file for SWE-agent
  (<https://arxiv.org/html/2405.15793>).
- **A handful of tools is safe.** Tool selection degrades with dozens of
  tools (<https://arxiv.org/abs/2505.03275>); nothing shows harm in going from
  two to four or five.

**What AI Search offers.** A search returns up to 50 chunks, each with its
text, its object's key and custom metadata, and its scores; it can add up to
three neighbouring chunks to each, switch keyword matching to `or`, boost by
a metadata field, and rerank with `@cf/baai/bge-reranker-base`, an English
cross-encoder, which has its own threshold, 0.4 unless a request sets another
(<https://developers.cloudflare.com/ai-search/api/search/workers-binding/>).
How the neighbouring chunks appear in a response is not documented.
Query rewriting applies only to follow-up turns of a conversation, and
`chatCompletions` writes an answer, which the assistant does itself. An
instance's similarity cache is on unless it is turned off, for 48 hours, and
its documentation does not say whether a request's filters are part of the
cache key. The platform's setup leaves an instance's chunk size at AI
Search's default, which is not documented. The corpora the platform serves
today are mostly in English.

There is no measurement of the platform's own search yet: no set of
questions, no recall, no answers graded. Every number in this record is a
starting point.

## Decision

### What `search` returns

**The index is asked broadly, and the answer is kept short.** The Worker asks
AI Search for 50 chunks in hybrid mode, with keyword matching set to `or`, a
vector `match_threshold` of 0.2, so that exact terms reach the ranking,
reranking by `bge-reranker-base`, and `context_expansion` of 1, so that each
passage reads as a paragraph rather than a fragment. The reranker orders the
chunks and, for now, drops none: its threshold is set to 0. A weak match
costs less than it did, since the assistant now reads why it matched; the
first evaluation decides whether the reranker's score should cut. All of it
is set in the request, so every deployment searches the same way without a
setup step.

**One result per document, with its best passages.** Chunks are grouped by
document in reranked order: at most ten documents, each with up to three
passages, and at most 24,000 characters of passage text in all, about 6,000
tokens. The budget goes breadth first: every document gets its best passage
before any gets a second, so the agent always sees the whole ten. A passage
is at most about 2,400 characters, since the chunk size is AI Search's and
not the platform's: a longer one keeps its middle, where the chunk that
matched sits between its neighbours, cut at sentence boundaries. Each result
keeps OpenAI's `id`, `title` and `url`, and adds:

- `text` — its passages, in rank order;
- `path` — the folders from the corpus root to the document, from the build;
- `modified` — when the document last changed in Drive.

**A passage is shown only where its text may go.** A result appears only for
a document the build lists and the reader may open, as before. Each passage
is also checked on its own: the class its chunk carries in the index must be
one the reader may read. The index's filter and its cache are not trusted
with either. A passage can come from an earlier version of a document the
reader may still open, until AI Search has synced the change; it never
reaches a reader outside the class of the text it was taken from.

**An empty answer says so.** With nothing to return, `results` is empty and
the text item says that no document the person may open matches, and to try
other or broader words. It is not an error.

**ChatGPT is checked before release.** OpenAI documents the three fields of a
result and says nothing of others. The extra fields are verified in ChatGPT's
chat, company knowledge and deep research before they ship. If ChatGPT
refuses them, this record is revised, with a second resource in OpenAI's
strict shape beside `/mcp`, as Microsoft Learn serves one.

### What `fetch` returns

**The text is the document, and the facts are metadata.** The copy published
to R2 is the projection's body, without its front matter, so the index no
longer indexes bookkeeping. `fetch` returns that body as `text`, and in
`metadata` when the document last changed, its `path`, and its `source`: the
link to the Google Doc or PDF that the page on the site already shows its
reader. The catalog in the access map carries the path and the source
alongside the title, from the build.

**A document is read whole.** The knowledge base keeps documents short
enough for that, and the content health page names those that are not
(ADR-043), rather than the server reading long ones in parts. `fetch` still
cuts a document at 100,000 characters; the cut text ends with a line saying
that the document continues and where the whole of it is. Whether a document
at that limit fits Claude Code's cap is checked before release, and the limit
lowered if it does not.

### How the tools describe themselves

The tools' descriptions say what each returns: passages, path and date from
`search`, the whole document from `fetch`. The server's instructions describe
how to use them together: start with short, broad queries and narrow them,
read a document with `fetch` when its passages are not enough, cite its
`url`. Nothing in a description instructs the assistant beyond describing the
tool.

### What stays as it is

Two tools, with their names, their required fields and their annotations.
No MCP resources or prompts, which the clients that matter most do not use.
No query rewriting and no generated answers from AI Search. The AI Search
cache is not relied on for anything.

### Considered and not adopted now

- **Returning everything AI Search can give** — 50 chunks, each with three
  neighbours on either side: tens of thousands of tokens a call, past Claude
  Code's cap, and against every measurement above.
- **Reading a long document in parts or by section**: short documents are the
  simpler cure (ADR-043). Section reading returns if they stay long.
- **Matching each passage to the build by hash**, which would hide a passage
  from an earlier version: the lag is accepted, since it cannot widen who
  reads a text.
- **Indexes built by a language model** — Contextual Retrieval's chunk
  context, RAPTOR's summaries, GraphRAG: they measurably help, but AGENTS.md
  forbids an LLM transformation of content. Deferred, not rejected: a later
  record may weigh measured gains against that invariant.
- **Several queries a call, or a concise and a detailed format**: little
  evidence of benefit, and ChatGPT would not use them.

## Consequences

### Positive

- An assistant sees why a document matched, and answers many questions from
  the passages without reading whole documents.
- Code names, acronyms and other exact terms reach the results.
- Results carry where a document sits and how old it is, which tells similar
  documents apart and flags stale ones.
- `fetch` returns content only, and the index no longer holds bookkeeping.
- The shape stays the one ChatGPT's deep research needs, so every client
  keeps working.

### Negative

- A search costs about 6,000 tokens where titles cost a few hundred.
- A passage may show text a document has since dropped, until AI Search
  syncs.
- The thresholds, the budget and the number of passages are unmeasured.
- The reranker is trained on English. A question in another language still
  finds an English document by meaning, but is ranked less well.
- Reranking adds latency to every search.
- ChatGPT may ignore the extra fields, or refuse them.
- Changing the copy in R2 republishes and reindexes every document once.

### Follow-up

- When ADR-042 is accepted, mark ADR-041 as superseded in part.
- An evaluation: the platform runs a set of questions against a deployment
  and reports document recall at ten, answers graded by a model calibrated
  against about fifty human grades, citation support, calls and tokens, over
  several runs. Synthetic questions over the fixture run in CI; 50 to 100 real
  questions — lookups, questions across documents, "list them all",
  unanswerable ones, acronyms — live in each project's repository, never in
  this one. The first run sets this record's numbers.
- Verify the extra `search` fields in ChatGPT, and the 100,000-character
  `fetch` in Claude Code, before release.
- Optional `search` parameters for a folder and a modified-after date, for
  chat clients. The objects' keys are flat, `docs/<short ID>.md`, so a folder
  filter needs the path as custom metadata; there are five fields and three
  are used.
- Read-only tools to list a folder and to list recent changes, for questions
  that ask for everything of a kind; no more than four or five tools in all.
  ADR-041 already notes a `browse` tool.
- The section a passage comes from, if reading by section returns.
- A deterministic heading-path prefix for each chunk, the share of
  Contextual Retrieval's gain that needs no language model, once there is a
  way to measure it.
