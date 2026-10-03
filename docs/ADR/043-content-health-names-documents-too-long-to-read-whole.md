# ADR-043: Content health names documents too long to read whole

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-042 has an assistant read a document whole with `fetch`, rather than in
parts, and cuts it at 100,000 characters. Past that cut an assistant does not
see the end of the document at all. Well before it, a long document costs: a
single `fetch` of 100,000 characters of English is about 25,000 tokens, the
cap Claude Code puts on a tool result; models answer worse as their input
grows, and worse still when what they need sits in the middle of it
(<https://arxiv.org/abs/2307.03172>,
<https://www.trychroma.com/research/context-rot>); and reading the right
section beats reading the whole (ADR-042).

The cure is in the corpus, not in the server: a long Google Doc split into a
folder of shorter documents, one subject each, is easier to find and to read
for people and for assistants alike, and each part gets its own address,
title and passages in search. Editors cannot see the problem today: nothing
in the sync report or on the content health page measures a document's
length.

A PDF is different. It is published as it is in Drive (ADR-027), and its
editor usually cannot split it the way a Google Doc can be.

The sync already notes one thing by size: an image above
`sync.largeImageMegabytes`, a line the project sets because what is too large
was not settled, which ADR-037 ranks under Improve.

## Decision

**The sync measures every published document.** Its length is the number of
characters of the Markdown body the sync writes for it, without the front
matter: the text the site's projection serves and `fetch` returns. It is
counted as `fetch` counts it, and the same way on every run, so the notes are
deterministic. It is read from the output the run writes, as image sizes are,
so a changed line applies on the next run without exporting anything again.

**Two steps, two priorities.**

- Over `sync.largeDocumentCharacters` — 40,000 characters unless the project
  sets another line, about 10,000 tokens of English — a Google Doc is noted
  under **Improve**: split it into a folder of shorter documents, one subject
  each, so that people and assistants find and read the part they need.
- Over the limit at which `fetch` cuts a document, `mcp.fetchCharacters`,
  100,000 characters by default, it is noted under **Fix next**: assistants
  read only its beginning, and do not see the rest.

A document over both lines gets the one note, under Fix next, which says to
split it too.

**A PDF is noted, not told to split.** A PDF over either line is noted under
Improve with its length, and, over the second, that assistants read only its
beginning.

**The check runs whether or not the MCP server is on.** A long document is as
hard to read on the site.

**Both lines are the project's.** `sync.largeDocumentCharacters` is
optional, a whole number above 0 and no greater than the limit; anything else
is a configuration error. Unset, it is 40,000, or the limit where the limit is
lower, so that a project that lowers only the limit is still valid. The limit is `mcp.fetchCharacters`, the cut `fetch`
makes (ADR-042), 100,000 unless the project sets another; with MCP off, its
default. The note and the cut read the same setting, so they cannot drift
apart.

**Each new note code is ranked** on the content health page, as ADR-037
requires of every code, and the unit test that reads the fixture reports
fails on one without a rank: `document-over-agent-limit` under Fix next,
`document-long` and `pdf-long` under Improve. The fixture corpus gains a
document over each line; the fixture project sets both lines low, so that
those documents stay short.

## Consequences

### Positive

- Editors see which documents assistants cannot read whole, and which are
  only long, ranked with the rest of their work.
- The server stays simple: no reading in parts, no section index.
- Splitting a long document helps the site's readers and its search as much
  as assistants.

### Negative

- Splitting is editors' work, and moves content to new addresses. The
  document that is split keeps its permanent link for the part it keeps.
- 40,000 characters is a starting value, not a measured one.
- Characters are not tokens: the same length costs more tokens in some
  languages than in English, so the first line is looser for them.
- A long PDF stays long; the note only says so.

### Follow-up

- Set the default line with the evaluation ADR-042 calls for.
- If many documents stay over the limit, revisit reading by section
  (ADR-042).
