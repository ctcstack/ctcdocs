# ADR-054: Content health leaves alone files kept on purpose

- Status: Proposed
- Date: 2026-11-03
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The content health page is a list of work (ADR-024, ADR-037). Editors read
every entry as something to fix, and two kinds of entry asked them to fix
files they keep in Drive on purpose:

- **Another format of one document.** `duplicate-name` (ADR-049) noted any
  two files in one folder whose names the site cannot tell apart, case,
  punctuation and extension aside. A team that keeps a Google Doc beside its
  PDF, or a recording beside the notes on it, under one name, saw every such
  pair as a copy to remove.
- **An archive a document hands its readers.** ADR-025 lists every file the
  site leaves out, and an archive is one, so it was listed under "Fix next"
  with advice to unpack it. A document that explains a process and links to
  the archive its readers download made that advice wrong. The document
  itself was also noted, because its link leads to a Drive file the site
  does not publish (`link-outside-site`), with advice to publish the file.

## Decision

**Files of different formats may share a name.** `duplicate-name` groups the
documents of one folder by their name and their MIME type, so a Google Doc,
a PDF and a video called the same are three formats, not three copies. Two
files of one format with one name are still noted.

**An archive a published document links to is not work.** The sync reads the
links of every published page when the inventory holds an archive, as Drive
addresses and Drive download addresses (`uc?id=`,
`drive.usercontent.google.com/download?id=`). An archive one of them names
gets the reason `archive-linked`, "Archives a document links to", in place of
`archive-file`. The report still lists it, as ADR-025 asks of every file the
site leaves out, and the job summary shows it. The content health page does
not list it and does not count it: the page has no work for it.

A document whose every link the sync notes for leaving the site, a Google
address that says what the file is, leads to such an archive gets no
`link-outside-site` note. A document with any other such link keeps it.

Both are decided from the inventory and the published output, so an
unchanged Drive writes the same report byte for byte.

## Consequences

### Positive

- The page asks editors only for work they can do; the teams that keep
  several formats of a document, or hand out archives, stop dismissing the
  same entries on every sync.
- The report still names every file the site leaves out (ADR-025).

### Negative

- A PDF exported from a document and left behind as a stale copy is no
  longer noted by its name. Near-duplicate detection (ADR-049) still notes
  it while the texts are alike; once they drift apart, nothing does.
- Two pages with one title remain, the second with a code on the end of its
  address. Readers tell them apart by the icon of their format.
- Every run that finds an archive parses the links of every published page
  once more.
- An archive that stops being linked returns to "Fix next" on the next sync,
  which may surprise the editor who removed the link.
- The links are read from what the site publishes. While the only document
  that links to an archive is held back with no earlier version on the site
  (ADR-026), nothing says the archive is linked, and it is listed under "Fix
  next" beside that document's own failure until the document is published.

### Follow-up

- When a page can carry a file other than its own, an archive may get a page
  of its own instead; this record then needs revisiting.
