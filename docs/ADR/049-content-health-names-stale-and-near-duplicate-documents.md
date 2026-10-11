# ADR-049: Content health names stale and near-duplicate documents

- Status: Proposed
- Date: 2026-10-11
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The content health page (ADR-024, ranked by ADR-037) turns what the sync
knows into work for editors. Two problems that readers and assistants meet
are invisible to it.

**Copies.** `duplicate-name` notes two files in one folder that the site
cannot tell apart by name. A copy with another name, in another folder, or a
policy pasted whole into a longer document, is not noted at all. Copies drift
apart as one of them is edited, and an assistant that finds both answers from
either; knowledge-management products treat duplicate detection as part of
upkeep (Guru runs it weekly at 90% similarity, Slite merges duplicates in
bulk). Measured on one deployment's corpus of about 235 comparable documents,
the text of nine pairs was at least 83% the same by five-word shingles, one
short document stood 99% inside a longer one, and documents written from one
template, which are not copies, shared at most 42%.

**Age.** Nothing tells an editor that a document has gone unedited for a long
time. Readers and assistants see its date (ADR-042, ADR-044) but cannot tell
whether an old document still holds. Knowledge-management products mark such
content as stale or due for review (Document360's review reminders, Slite's
expired verification, Glean's re-verification).

Both can be measured from what the sync already has: the text of every
published document in its output, and the time Drive last saw it edited in
the manifest.

## Decision

**Two notes join the catalog.**

- **`document-near-duplicate`, under Fix next.** The sync compares the text
  of every published document with every other. A document's text is its
  words and link targets, read from its Markdown with the parser the sync
  already uses; markup and image addresses are not part of it, and link
  targets are, since a directory of links differs from another of the same
  shape by where they lead. It becomes a
  set of five-word shingles, and two documents are near duplicates when
  - their Jaccard similarity is at least 0.8, or
  - at least 95% of the shorter one's shingles are in the other.

  A document of fewer than 50 shingles is too short to judge and is left out.
  Each document gets one note naming the others, at most three by name: "nearly
  the same text as" with the share in common, "its text is also in", or "holds
  the text of". The action: keep the text in one document and link to it.

- **`document-stale`, under Improve.** A document Drive last saw edited longer
  ago than the line it is held to is noted with the day of that edit. The
  line is `sync.staleAfterMonths`, 12 months unless the project sets another,
  and 0 notes nothing. A folder listed in `sync.staleFolders` holds everything
  below it to its own line, 0 included, the nearest listed folder winning.
  The action is a review, not a fix: an old document may be right.

**Candidates come from a sketch, every result from a whole comparison.** The
sync indexes shingles by document and pairs each document with every other
that holds one of its 16 lowest-hashed shingles. Two documents of which one
has 80% of its text in the other share one of those all but certainly,
however many copies there are, while a phrase every template repeats is
rarely among a document's sixteen. Each candidate pair is then compared over
all its shingles, so the result is exact, and documents are taken in the
order of their IDs, so it does not depend on the order they arrive in.

**The notes say the same thing on every run until something changes.** The
stale note gives the date of the last edit, not an age, so it changes only
when the document is edited, when it crosses the line, or when the line
changes.

## Consequences

### Positive

- Editors see copies that `duplicate-name` cannot, with the documents named,
  before readers and assistants find two answers.
- Old documents reach their owners as a review, filtered by section and last
  editor like every other note.
- No model, no service, no new identity: both notes are deterministic
  measurements of the run's own output.

### Negative

- The stale note depends on the run's time: a document crossing its line is a
  change in the sync report although nothing in Drive changed.
- An edit that only touches a document resets its age; the note measures
  edits, not reviews.
- Thresholds were chosen on one corpus. Two documents that rightly share most
  of their text, such as a template and a form made from it, are noted until
  one of them changes.
- The comparison reads every published document's text on every run. It is
  linear in the shingles and quadratic only in the documents that share
  uncommon phrases, which a large corpus of templates could still make slow.
- Contradictions between documents that are not copies are not found; that
  needs a reading of meaning these measurements do not give.

### Follow-up

- Watch the false positives on deployments' first runs, and move the lines to
  the project configuration if one value does not suit every corpus.
- Owners and verification, if editors get a way to record a review in Drive
  without a new tool.
