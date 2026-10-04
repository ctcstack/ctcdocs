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
  returns (<https://developers.cloudflare.com/ai-search/configuration/retrieval/result-controls/>),
  so a threshold set high leaves little for the fusion to rank. Keyword
  matching also defaults to `and`: a chunk must contain every word of the
  query, so a question asked in a sentence gets little from BM25.
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
a metadata field, and rerank with `@cf/baai/bge-reranker-base`, the one
reranking model it supports, a cross-encoder trained on English and Chinese
that reads 512 tokens of each chunk and has its own threshold, 0.4 unless a
request sets another
(<https://developers.cloudflare.com/ai-search/api/search/workers-binding/>,
<https://developers.cloudflare.com/ai-search/configuration/models/supported-models/>).
Query rewriting applies only to follow-up turns of a conversation, and
`chatCompletions` writes an answer, which the assistant does itself. An
instance's similarity cache is on unless it is turned off, for 48 hours, and
a request can turn it off for itself with `ai_search_options.cache`. The
platform's setup leaves an instance's models and chunking at AI Search's
defaults: an instance it created indexes with
`@cf/qwen/qwen3-embedding-0.6b`, a multilingual model, in chunks of 1,024
tokens overlapping by 10%, with the `porter` keyword tokenizer, which stems
English. The corpora the platform serves are mostly in English, some in
other languages or mixed.

**What AI Search does, measured.** Where its documentation is silent or
says otherwise, the first measurement (below) found:

- `retrieval.match_threshold` is ignored while reranking is on: a request
  at 0 and at 0.6 returns the same chunks. With reranking off it drops only
  the chunks vector search found below it; a chunk keyword search found stays
  whatever its vector score, and keyword matches fill the places the
  threshold frees. It never cut an exact term.
- `context_expansion` joins the neighbouring chunks into the matched chunk's
  text and changes no ranking. With the default chunk size a chunk's text was
  2,600 characters at the median, 3,800 at the 90th percentile; with one
  neighbour on each side, 7,800 and 11,400.
- The search endpoint reported no cache status, and the same query under two
  class filters returned each filter's own chunks.

**What the first measurement showed.** A set of 34 questions was run against
one deployment's corpus, about 140 documents in English and Russian, as a
reader of its widest class: 15 questions in Russian and 19 in English;
lookups, questions across languages, acronyms and code names, questions that
need several documents, two that ask for every document of a kind, and two
nothing answers. The documents each answer needs were assigned by hand. Each
setting was varied alone from this record's defaults:

| Setting                     | Answer first | In top 3 | In top 10 | MRR   | Recall at 10 | Documents a search returns |
| --------------------------- | ------------ | -------- | --------- | ----- | ------------ | -------------------------- |
| The defaults                | 20 of 32     | 26       | 30        | 0.734 | 0.856        | 10                         |
| No reranking                | 16           | 22       | 28        | 0.616 | 0.848        | 10                         |
| Keyword matching `and`      | 20           | 25       | 29        | 0.724 | 0.822        | 10                         |
| Vector threshold 0.3 to 0.6 | 20           | 26       | 30        | 0.734 | 0.856        | 10                         |
| No neighbouring chunks      | 20           | 26       | 30        | 0.734 | 0.856        | 10                         |
| Reranking threshold 0.005   | 20           | 26       | 30        | 0.734 | 0.825        | 7.4                        |
| Reranking threshold 0.01    | 20           | 26       | 30        | 0.734 | 0.803        | 6.8                        |
| Reranking threshold 0.05    | 19           | 25       | 29        | 0.703 | 0.760        | 5                          |
| Reranking threshold 0.4     | 17           | 20       | 22        | 0.591 | 0.589        | 3.2                        |

- **The reranker earns its place, most of all across languages.** Without
  it, the mean reciprocal rank of the answer fell from 0.70 to 0.42 for the
  Russian questions, and stayed within noise for the English ones (0.76 and
  0.77).
- **Its score does not separate the relevant from the rest.** The best chunk
  of a needed document scored under 0.08 for one in five of them and under
  0.01 for one in ten, while one in ten unrelated documents scored over 0.88;
  a question nothing answers scored 0.054 at most. Any threshold that cuts
  noise also cuts needed documents, the second and third ones first, and
  cross-language ones most. At 0.005 it kept every answer and returned 7.4
  documents instead of 10.
- **Keyword matching `or` reaches more.** `and` lost one answer from the
  first ten and some of the other needed documents.
- **A search's noise is documents that suit every question.** Pages that
  describe the knowledge base itself were among the first ten of every search
  in an assistant's replayed session; where an access rule kept them to a few
  readers, the others never saw them. In a language the keyword tokenizer
  does not stem, short common words matched many documents in that language,
  which the reranker mostly ranked down.
- **The failures were of vocabulary.** A question in a reader's own words
  ("may I use a chatbot with client data") missed the policy that answers it
  in both languages, because the policy uses neither word; the policy's own
  terms found it first in both. Searching again in other words, which the
  server's instructions ask of the assistant, is the remedy, not a setting.
- **Passages reach their cap.** In an assistant's replayed session every
  result's passage was cut to its share of the budget, so a second passage
  fitted once in fifty results. Counted as the Worker counts them, a search
  over the 1,024-token index showed 11.6 passages, 23,500 characters.
- **Smaller chunks trade languages, not quality.** A second instance over the
  same bucket, differing only in 512-token chunks, put as many answers first,
  20, though not the same ones, with a mean reciprocal rank of 0.731 against
  0.734 and recall at ten of 0.868 against 0.856: English questions rose
  (0.76 to 0.81), Russian ones fell (0.70 to 0.63), each by one or two
  questions. A chunk's text fell to 1,470 characters at the median, under a
  passage's share, so a search showed 17.4 whole passages instead of 11.6 cut
  ones in the same budget. Whether more passages give better answers takes
  graded answers to tell.

The numbers come from one corpus and one person's judgment of the answers:
a difference of one or two questions is noise. The effects above are larger.

## Decision

### What `search` returns

**The index is asked broadly, and the answer is kept short.** The Worker asks
AI Search for 50 chunks in hybrid mode, with keyword matching set to `or`,
reranking by `bge-reranker-base`, and no neighbouring chunks
(`context_expansion` of 0). It sends a vector `match_threshold` of 0.2 as
well, which AI Search applies only with reranking off, and then only to
chunks vector search alone found. The reranker orders the chunks and drops
none: its threshold is 0, since the first measurement found no score that
cuts noise without cutting needed documents. A weak match costs less than it
did, since the assistant now reads why it matched. A chunk of AI Search's
default size is already longer than the passage a result shows, so
neighbouring chunks would add only text the Worker cuts away; a project that
indexes smaller chunks may ask for them. All of it is set in the request, so
the instance needs no setting of its own.

**The numbers are the project's to tune.** Every value in this record, from
the chunks asked for to the characters `fetch` returns, is a default of the
project's `mcp` section: `mcp.search` and `mcp.fetchCharacters` in
`site.config.json`, each optional and checked against the range AI Search
accepts. The build writes the resolved values into the access map, and the
Worker holds no number of its own, so measuring and tuning a deployment's
search takes a deploy of that project, not a release of the platform.

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

**A document is found only through text its reader may read.** A chunk
counts only when its document is one the build lists and the reader may
open, as before, and the class the chunk carries in the index is one the
reader may read. A chunk that fails either is skipped before its document
takes a place among the ten, so a match on text the reader may not read
neither shows the document, which would say that it matched, nor pushes out
a document they may read. Every result therefore has at least one passage.
The index's filter and its cache are not trusted with any of it. A passage
can come from an earlier version of a document the reader may still open,
until AI Search has synced the change; it never reaches a reader outside the
class of the text it was taken from.

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
- The defaults were measured once, on one corpus, against answers one person
  chose; the passage budget and the number of passages were not varied.
- `mcp.search.vectorThreshold` does nothing while reranking is on, which is
  the default. It is kept for a project that turns reranking off.
- The reranker is trained on English and Chinese. It still improved the
  ranking of Russian questions the most, but scores needed documents in
  another language than the question's low, so a reranking threshold costs
  those first.
- With reranking threshold 0, a search returns ten documents even when
  nothing answers the question.
- A chunk of the default size is longer than a passage, so a passage is the
  middle of a chunk and a document rarely shows a second one.
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
  this one. The first measurement above was a project's own script, which
  calls AI Search as the Worker does and ranks documents as the Worker does;
  the platform's tool can start from it.
- Choose the chunk size by graded answers: 512-token chunks ranked as well as
  1,024-token ones and showed half again as many passages, which only answers
  graded against the passages can value. The platform's setup keeps AI
  Search's default until then.
- Revisit the passage budget with the chunk size.
- Turn the cache off in each request if AI Search starts to cache searches:
  a response cached for one reader's classes could hide documents from
  another, though never open one.
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
