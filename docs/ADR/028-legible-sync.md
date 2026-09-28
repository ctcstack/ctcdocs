# ADR-028: Make every sync legible, grouped by what to do

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The sync does more with every release: it publishes PDF files, holds a
document back instead of failing, and records how each document was converted.
ADR-025 named every file the site leaves out, one row each, and the first
deployment to run it listed 38 files under one reason, "the site does not
publish this kind of file", which covered Word files, videos, spreadsheets and
archives alike. Each of those needs a different action, and the list did not
say which.

Other things the sync knew stayed where nobody reads them. The manifest records
per document what conversion changed, most of it routine, some of it a lost
link or image. Two files with one name in a folder became two pages called the
same, the second with a code on its address. The inventory counted order
numbers used twice. The job summary counted documents exported again as
"changed", so a full sync reported every document changed when one was. A sync
that failed wrote nothing to the job summary at all; the reason was a line in
the log.

The team adds features, and the sync gets more to say. What it says has to stay
readable as it grows.

## Decision

**Every list is grouped by what to do about it, and every group says so.** A
group is an entry in a catalog: a title, a short action for a table cell, and
an instruction worded for the person who can act. The content health page and
the job summary open each section with one table, a row per group, giving what
it is, how many, where they are by top-level section, and what to do, and then
list each group, folded when long. The page links each row to its list.

**A file the site does not publish is grouped by its kind:** Word and text
files, presentations, spreadsheets, video and audio, images, diagrams,
archives, and anything else. A draw.io file, which Drive stores as bytes, is
told by its name.

**Notes say what a reader would miss or an editor should know about a page
that is on the site.** They come from:

- what conversion lost: an image left out, a link removed, a link to a heading
  that now opens the top of a page, a merged cell split, unsupported
  formatting removed, a code block never closed, a PDF too long to index whole;
- files in one folder whose names the site cannot tell apart;
- what the inventory warned about: an order number used twice, a second
  landing document, a number not read as an order, an ignored folder that is
  not there.

Routine conversion is not a note. A document that went through the HTML export
for its images, or lost the inline styles the site replaces, reads the same on
the site.

**The sync report moves to schema version 3.** It carries both catalogs, the
notes, how many pages the site has of each kind, how many Google Docs came
through each export, and how many documents the run exported. It counts pages
the run added, changed or removed by their output, so a document exported again
to the same page is unchanged.

**Each part of the job summary is written by the step that knows it.**

- The sync step writes what the run changed: the pages it added, changed and
  removed, each linked, and the addresses that moved. A no-op run says nothing
  changed.
- The summary step writes the state of the site from the committed report.
- A sync that stops writes what stopped it, what that means, what to do, and
  the log lines, and that nothing was published.

The job summary already names files (ADR-025); it now also names the pages a
run changed.

**The content health page opens with an overview**: pages on the site by kind,
files not on it, notes, documents to fix, each linking to its section, and when
the site last changed.

## Consequences

### Positive

- Each file off the site comes with the action that fits it, and the table
  shows at a glance where the work is.
- What conversion lost is visible per page for the first time, and a clean
  corpus says so.
- A run's summary says what it changed, not how much it worked, and a failed
  run explains itself where the operator looks.
- A new kind of problem is one catalog entry, and the page and the summary show
  it without further work.

### Negative

- The job summary names the pages a run changed, as well as the files it left
  out.
- The report is larger, and a change in the notes alone writes a new one.
- Grouping by kind is a table of MIME types and names; a file of an unlisted
  kind lands under "other".
- Two names are "the same" when their addresses would be, so `Plan` and
  `plan!` are noted together.
- The run summary exists only for runs of this version and later; the report
  keeps no history of runs.

### Follow-up

- Consider a weekly digest of the overview to a chat channel if the page and
  the job summary are not enough.
