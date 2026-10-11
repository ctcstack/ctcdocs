# ADR-048: The indexed copy says where each section sits

- Status: Proposed
- Date: 2026-10-11
- Owners: CTCDocs maintainers
- Supersedes: ADR-042 in part, once accepted: the object in R2 is the text
  with where each section sits written in, not the text alone, and `fetch`
  reads a document from the build's Markdown version, not from R2

## Context

AI Search cuts each document in R2 into chunks of a few hundred tokens and
ranks the chunks against a query (ADR-042). A chunk cut from the middle of a
document carries only its own words: "the limit is $500" does not say which
limit, in which policy, for which team. Anthropic's Contextual Retrieval
measured what that costs: a short context written onto each chunk before it
is indexed cut failed retrievals by 35%, and by 49% with keyword search over
the same text
(<https://www.anthropic.com/news/contextual-retrieval>). Its context is
written by a language model, which `AGENTS.md` rules out for content, and
ADR-042 deferred it for that reason, noting as a follow-up the share of the
gain that needs no model: the document's title and the headings a passage sits
under.

A deployment's own measurement shows the misses this targets. Of 32
questions, five found the right document and missed the passage that answers,
and the misses were of vocabulary: a question in a reader's words found
nothing a document did not say in its own.

The object in R2 is also what `fetch` returns today: the Worker reads it back
and checks its hash against the build. Writing context into the object would
put it into every document an assistant reads.

A second, smaller gap is the language. AI Search's keyword index stems one
language and its reranker reads English and Chinese; a question asked in
another language than the documents' ranks worse, and an assistant translates
better than any step the server could add.

## Decision

**The copy in R2 says where it sits.** It is the document's text, as before,
with two kinds of line added, and nothing else changed:

- above the text, the document's folders and title, as a trail:
  `Team › People › Leave policy`;
- under each heading, the document's title and the headings the section sits
  under: `Leave policy › Requests › Approval`.

A chunk that starts anywhere after a heading then carries the words that say
what it is about. A heading that only repeats the title is left out.

**The build finds the headings; the Worker writes the lines.** The build
parses each document's text with the Markdown parser it already uses and lists
its headings in the catalog: where each heading's line ends in the text, its
depth and its words, at most 120 characters. The Worker, which has no parser,
writes the lines from that list when it publishes, and ignores a list that does
not fit the text. A document's hash covers its folders and a version of the
copy's shape as well as its text, class and title, so moving a document or
changing the shape rewrites the objects that change, once, through the same
comparison of hashes as today.

**`fetch` reads the build, not the bucket.** It reads a document's Markdown
version from the build's static assets, the same file the publication reads,
and returns it without its front matter, as before. The bucket becomes the
index's alone. A rollback or a publication that lags a deploy can no longer
make `fetch` refuse a document: the text is always the build's own, and the
reader is judged by the build's classes as before.

**Assistants are told the documents' language.** The access map carries the
language of `sync.defaultLocale` by its English name, and the server's
instructions, the `search` description and its query field say that the
documents are written in it and that a query in it finds more. No language
can be named, and nothing is said.

## Consequences

### Positive

- Chunks carry their document and section, which keyword search and the
  embedding both read; no model and no service is added.
- `fetch` no longer depends on the bucket: it answers from the moment a build
  is deployed, and the check of another build's text is gone with the case it
  guarded.
- An assistant that follows the instruction searches in the language the index
  serves best.

### Negative

- Every document is rewritten in R2 and reindexed once when this ships, and
  again whenever the shape's version changes.
- The lines take part of each chunk, and the reranker reads only its first 512
  tokens; a short line per heading keeps the cost small, but it is not zero.
- A search passage shows the lines as part of the chunk.
- The access map bundled with the Worker grows by every document's headings,
  about a third on one deployment of 265 documents.
- Whether it helps is measured, not known: on one corpus, in one language. The
  deployment's golden set decides whether it stays.
- An assistant may ignore the instruction to search in the documents'
  language.

### Follow-up

- Measure the golden set on a deployment before and after, with nothing else
  changed, and revert the lines if retrieval does not improve.
- Measure the questions in another language than the documents' as an
  assistant would send them, translated, to see what the instruction is worth.
- Reading a document by section, if it returns, can use the same outline.
