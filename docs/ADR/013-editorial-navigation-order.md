# ADR-013: Editorial navigation order from Drive names

- Status: Accepted
- Date: 2026-08-01
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The published corpus is a Drive tree, and readers move through it in the order
the sidebar presents. That order has to be an editorial decision — an
introduction before the procedure it introduces — not an accident of the
alphabet or of who edited what last.

Drive gives the pipeline nothing to read for this. The API exposes no stored
manual arrangement; the sort a person picks in the Drive interface is a view
setting, not a property of the folder. Writing ordering metadata back to Drive
is closed off by an invariant: the synchronization identity is read-only and
must not create, edit, move, delete, or change permissions. What remains is the
one field an editor already controls from the Drive interface — the name of the
folder or document itself.

The pipeline has parsed a numeric prefix out of that name since the sidebar was
first generated, and the current corpus relies on it. Three things about it
were never decided.

The prefix grammar was permissive to the point of being unsafe. It accepted any
run of digits followed by a space, so a document legitimately named for a year
or a quantity lost its first token — from the sidebar label, from the heading,
and from the slug, because slug allocation strips the prefix too. A name
becoming a wrong URL is the serious end of that: slugs are stable identifiers
and the redirect machinery exists precisely because they are expensive to
change.

Nothing gave a folder's landing document a fixed position. A folder's overview
is the page a reader should arrive at first, and it only sorted first when its
title happened to win alphabetically.

The idea of a landing document existed twice. The sidebar generator knew
nothing about it, while the wiki app carried its own hardcoded list of titles
to pick a folder's description from. Two lists, one concept, no shared
definition.

## Decision

Ordering is derived from Drive names by one function, applied at one place in
the pipeline, and consumed by the generated sidebar.

**The prefix grammar is explicit and narrow.** A leading order marker is one to
three digits, either followed by a hyphen, en dash, em dash, or full stop, or
enclosed in square brackets. Whitespace around the separator is optional.
Anything else at the start of a name is content.

```text
01 — Section     ordered
1 - Section      ordered
01. Section      ordered
[002] Section    ordered
2024 Report      not ordered; the year is part of the title
01 Section       not ordered
```

Requiring a deliberate separator is what makes the rule safe: a bare space
cannot distinguish an editor numbering a folder from an author writing a year,
and the pipeline must not guess when guessing wrong rewrites a URL.

**The order key has three tiers**, applied among the siblings at one level of
the tree:

```text
0  no prefix, and the title names a landing document
1  prefixed, ascending by number
2  everything else, alphabetically
```

Ties break on the label, then on the Google file identifier, so the output is
total and deterministic. An explicit prefix outranks the landing convention: a
document deliberately numbered is placed where its editor numbered it, and only
an unnumbered landing document is promoted.

**The landing titles are configuration.** `sync.landingDocumentTitles` in
`config/site.config.json` holds them, and the list order is the precedence
order, so a folder containing more than one still has a defined first page. The
wiki app reads the same list for the folder description it already renders,
which removes the duplicate definition rather than adding a second one.

**Order is navigation, not content.** It does not enter document frontmatter,
the slug, or the content hash; it reaches the reader through the generated
sidebar, and Starlight's previous/next links follow from that. The manifest
keeps `sortOrder` as a record of what was parsed, and it stops participating in
the comparison that decides whether a folder change invalidates documents:
renumbering a folder changes navigation only, and must not re-export the
corpus.

**Two surfaces keep their own order, deliberately.** The home page ranks by
edit recency, because it answers "what has changed" rather than "where do I
start". The AI index stays ordered by slug, because it is consumed by machines
that need a stable sequence rather than an editorial one.

**Ambiguity is reported as a synchronization warning**, on the channel the
inventory warnings already use and under the same `SYNC_FAIL_ON_WARNING`
switch. Three cases are ambiguous rather than merely unusual: two siblings
claiming the same number, two landing documents in one folder, and a sibling
opening with one to three digits and a space in a folder where the convention
is already in use. A folder mixing numbered and unnumbered items is not
reported — the three tiers define that case exactly, and warning on a supported
arrangement would train operators to ignore the channel.

Naming is not a repository error. The content lives in Drive, and a rename
there must not fail the gate that guards the repository.

## Consequences

### Positive

- An editor orders the wiki by renaming a folder or document in Drive, with no
  repository change, no pull request, and no second system to learn.
- Renumbering is free at the URL level: the prefix never reaches the slug, so
  reordering breaks no links and allocates no redirects.
- A folder's overview is first without anyone numbering it, and the same
  definition drives the description the home page shows for that folder.
- A name beginning with a year or a quantity survives intact into the title,
  the heading, and the URL.
- An ambiguous arrangement is named in the sync report, on the run that
  introduced it, instead of being discovered by a reader finding a section out
  of sequence.

### Negative

- The order is invisible in the generated Markdown. Reading a document file
  does not reveal where it sits in the sidebar; diagnosing order means reading
  the generated sidebar or the manifest.
- The product now has two ordering models — editorial in the sidebar, recency
  on the home page — and a reader who learns one does not get the other.
- The landing convention is implicit by construction: a document is promoted to
  first position by its title, with nothing in its name saying so. Putting the
  list in configuration and warning on a second landing document narrows the
  surprise; it does not remove it.
- The grammar is stricter than the one it replaces. A name separated by nothing
  but a space, such as `01 Section`, stops ordering. No name in the current
  corpus is affected, but the loose form has to be unlearned.
- Numbering a document still changes its Drive name, which re-exports that
  document on the next run. Ordering is cheap, not free.

### Follow-up

- Document the naming convention where editors will see it, alongside the
  content lifecycle operations in `docs/OPERATIONS.md`, and add the new key to
  `docs/CONFIGURATION.md`.
- Build the fixture for the grammar before the parser changes, per the
  `converter-change` workflow, covering each accepted separator, the rejected
  forms, and the three-tier key.
- Confirm on the next full run that ordering-only changes produce a sidebar
  diff and no document diff.
