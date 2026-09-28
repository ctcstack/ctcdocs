# ADR-025: Name every file the site leaves out, and why

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The sync publishes Google Docs. Everything else under the publication root is
counted as unsupported and passed over: sheets, slides, PDFs, uploaded Office
files, images, shortcuts. The sync report kept the count and nothing else.
Folders the configuration ignores were counted the same way.

An editor who put a file in a published folder saw it never appear, and
nothing said why. An operator saw a number in the job summary and could not
tell what was behind it without running an inventory with Google credentials,
which only the protected workflow holds. A document Google refuses to export
failed the whole run, and its file ID was the only clue in the log.

The content health page (ADR-024) is where editors already go to see what to
fix, and the job summary is where an operator looks after a sync.

## Decision

**The sync report lists every file under the root that the site does not show
as it is in Drive.** `data/latest-sync-report.json` moves to schema version 2.
Each entry carries the Drive name, the folders above it, the kind of file in
words (`Google Sheets`, `Image (PNG)`, `Shortcut to Google Docs`), its MIME
type, a status, a reason, a link to it in Drive and who last edited it. The
statuses are:

- `not-published`: nothing of the file is on the site;
- `out-of-date`: the site shows an earlier version, with its address and the
  time that version was edited (ADR-026).

The reasons are a catalog, like the content health checks: a code, a title and
an instruction worded for the person who can act. The report carries the
catalog, so the page, the job summary and the terminal say the same thing:

- `unsupported-type`: the site does not publish this kind of file;
- `shortcut`: shortcuts are not followed;
- `export-too-large`, `download-restricted`, `content-rejected`: a document
  the run could not export (ADR-026).

The report also lists each ignored folder with its path and the number of
items below it. Items inside an ignored folder are not listed one by one: they
are left out on purpose, by whoever maintains the configuration.

The list is a pure function of the inventory and the run's failures, sorted by
path. An unchanged Drive rewrites the report byte for byte. A file that appears
in or leaves the list writes a new report even when the manifest is unchanged.
A targeted run exports one document and carries forward what an earlier run
recorded about the others.

**The content health page lists them first**, under "Not on the site",
grouped by reason, with the instruction, a link to Drive, and a link to the
page on the site for a document out of date. The section and editor filters
apply to them as to every other item.

**The job summary names the files.** It lists status, reason, folder, name and
type, up to 200 rows, and links to the page for the rest. This departs from
ADR-024, which keeps document names out of the job summary. A file that never
reached the site cannot be found on it, and the job summary is where an
operator looks after a sync. Names are escaped so that none becomes markup or
a new column. The run log still prints reason codes and counts only.

## Consequences

### Positive

- Nothing in a published folder is left out silently. An editor learns from
  the page why a file is missing and what to do about it.
- An operator can answer "why is it not on the site?" from the job summary
  without Google credentials.
- The count of unsupported files becomes a list a decision can be made from,
  for instance whether another kind of file is worth publishing.

### Negative

- The job summary of the project's sync workflow now carries Drive names and
  the display names of editors. The project repository is private and its
  generated data already holds both, but whoever can read the workflow runs
  can read them, for as long as GitHub keeps the run.
- The report holds names of files that are not published, including the names
  of ignored folders.
- The report schema moves to version 2. The first sync after upgrading
  rewrites it.
- The page lists items that editors may not be able to fix, such as a shortcut
  kept on purpose. The remedy is to move it, or to ignore its folder.

### Follow-up

- If a kind of file shows up in numbers, decide whether to publish it in its
  own ADR.
