# ADR-019: Folders before documents, and a section page that tells them apart

- Status: Proposed
- Date: 2026-09-23
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A section page (ADR-014) lists what a folder holds as one Markdown list: a link
per subfolder and per document, in the ADR-013 order. The list does not say
which entry is which. A subfolder and a document look the same, and so do an
empty subfolder and a full one. A reader finds out by clicking.

ADR-013 orders unnumbered siblings alphabetically, whatever their kind, so
subfolders and documents are interleaved. A folder's divisions are scattered
among its pages, which is the opposite of how every file browser a reader has
used presents a folder.

The Markdown body cannot carry the difference by itself. A link to a folder and
a link to a document have the same shape. Styling a link by guessing its kind
from its address would be a regular expression over generated output. A
build-time lookup against the manifest would be a hidden coupling between the
body and a file the site does not otherwise read.

## Decision

**Among unnumbered siblings, folders come before documents.** The comparator
ADR-013 defines gains one step in its third tier: folders first, then
documents, each alphabetical. The first two tiers are untouched. A landing
document still opens its folder, and an editor's number still places an item
exactly where it was numbered, folder or document. Both are decisions someone
made; kind is only a default. The rule lives in the one comparator, so the
sidebar and every section page change together and cannot disagree.

**A section page records its listing as data.** The generated frontmatter
gains `entries`, one record per listed item, in listing order:

```yaml
entries:
  - kind: folder
    slug: team/runbooks
    documentCount: 3
  - kind: document
    slug: team/guide
```

`documentCount` counts the published documents anywhere below the subfolder.
It is the number that tells a reader whether opening the folder is worth the
click, and it makes an empty folder visible without anyone opening it. Labels,
descriptions and dates are not repeated there. The site reads them from the
page each entry points at, so the listing and its targets cannot disagree.

The Markdown body is unchanged. It is still a plain list, readable as it
stands, and the fallback wherever the entries cannot be drawn.

**The site draws the listing from the entries.** An override of Starlight's
`MarkdownContent` renders a section page's entries in place of its body.

- A folder row shows a folder glyph and its document count ("Empty" when there
  are none).
- A document row shows a document glyph, the date its source was last edited,
  and its description, clamped to two lines.

The glyphs are decorative. Each row's kind also reaches a screen reader as
text. The row follows the ruled record that the full index and the recency band
already use. Every other page renders exactly as before.

**Absent or unusable entries fall back to the body.** The entries are optional
in the site's schema and in the output validator. A targeted sync carries
section pages over unchanged, so a page generated before this release has
none, and it stays valid until the next full run rewrites it. The site also
falls back when an entry points at a page that does not exist or at the wrong
kind of page. The validator rejects an entry whose slug the manifest does not
record for that kind.

The content hash of a section page still covers its body only. The entries
repeat the body's slugs and order, and the one thing they add, a document count,
is navigation rather than content.

## Consequences

### Positive

- A reader tells a folder from a document, and an empty folder from a full one,
  before clicking.
- The sidebar and the section pages list a folder's divisions before its pages,
  the arrangement readers already expect.
- The Markdown body stays standard Markdown and remains correct on its own.
- Editors keep the control ADR-013 gave them: a number in a Drive name still
  wins.

### Negative

- The sidebar order changes for every deployment on the first full sync after
  upgrading: in any folder mixing unnumbered subfolders and documents, the
  subfolders move up. Previous and next links follow.
- Every section page is rewritten on that sync, and afterwards a document added
  or removed anywhere below a folder rewrites the section page of every folder
  above it, because its count changed. Generated-content commits grow
  accordingly.
- The listing now depends on two sources agreeing: the entries in one file and
  the pages they point at. The fallback makes a disagreement plain rather than
  broken, but it is a second path to keep correct.
- Overriding `MarkdownContent` means a Starlight upgrade that changes that
  component's contract has to be checked here.

### Follow-up

- After upgrading, run a full sync so every section page gains its entries.
