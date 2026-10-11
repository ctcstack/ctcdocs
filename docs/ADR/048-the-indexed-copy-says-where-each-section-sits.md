# ADR-048: The indexed copy says where each section sits

- Status: Rejected
- Date: 2026-10-11
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

AI Search cuts each document in R2 into chunks of a few hundred tokens and
ranks the chunks against a query (ADR-042). A chunk cut from the middle of a
document carries only its own words. Anthropic's Contextual Retrieval
measured what context written onto each chunk is worth: failed retrievals
fell by 35%, and by 49% with keyword search over the same text
(<https://www.anthropic.com/news/contextual-retrieval>). Its context is
written by a language model, which `AGENTS.md` rules out for content; ADR-042
noted as a follow-up the share of the gain that needs none: the document's
title and the headings a passage sits under.

## Proposal

The copy of each document in R2 would name its folders and title above the
text, and under each heading the title and the headings the section sits
under: `Leave policy › Requests › Approval`. The build would list each
document's headings in the catalog, and the Worker would write the lines when
it publishes. Because the lines would then reach an assistant reading a
document whole, `fetch` would read the build's Markdown version instead of
R2.

## Measurement

One deployment's corpus of 265 documents was published twice, as plain
copies and as copies with the lines, to two new AI Search instances with
production's settings (800-token chunks with 10% overlap, the same embedding
model, hybrid search with a porter tokenizer and reciprocal-rank fusion).
Both indexed every document before the project's 34 questions were run
against each with the Worker's own ranking, reranking on:

| Measure                            | Plain copies | With the lines |
| ---------------------------------- | ------------ | -------------- |
| Needed document first              | 18 of 32     | 20 of 32       |
| In the top 3                       | 26           | 24             |
| In the top 10                      | 29           | 28             |
| MRR                                | 0.682        | 0.694          |
| MRR, questions in English          | 0.764        | 0.813          |
| MRR, questions in another language | 0.577        | 0.540          |
| Recall of the list                 | 0.827        | 0.818          |
| Answer shown                       | 26 of 32     | 25 of 32       |

The lines improved six questions and worsened seven, five of those in
another language than the documents'. The overall difference is within the
noise of one or two questions.

## Decision

**Rejected.** The copy in R2 stays the document's text alone, and `fetch`
keeps reading it from R2.

- The gain did not show on the corpus it was meant for, and questions in
  another language than the documents', the weakest part of that corpus's
  search, got worse. A likely cause: the reranker reads the first 512
  tokens of a chunk, and the lines take part of them.
- It would have cost a clean copy of each document in R2, which is where
  documents are meant to live if generated content moves out of Git, and a
  second source of a document's text for `fetch`.

## Consequences

### Positive

- R2 keeps one clean copy of each document, read by AI Search and `fetch`
  alike.
- No reindex of the corpus for a change that does not measurably help.

### Negative

- A chunk from the middle of a document still does not say where it comes
  from.

### Follow-up

- Reconsider only with a measurement that shows a gain: a context line that
  does not crowd the reranker's window, a reranker that reads the documents'
  language, or a larger golden set. If it returns, keep the clean copy
  canonical and publish the indexed copy beside it under a path AI Search
  alone reads, rather than moving `fetch` off R2.
